import * as vscode from 'vscode';
import { ConflictInfo, FileRange, Member } from '../types';
import { CampDiffTreeProvider } from './treeDataProvider';

interface LocalConflictSide {
  range: FileRange;
  otherMember: Member;
  otherRange: FileRange;
}

function toPosixPath(filePath: string): string {
  return filePath.split('\\').join('/');
}

function getLocalConflictSide(conflict: ConflictInfo): LocalConflictSide | undefined {
  if (conflict.memberA.isLocal) {
    return {
      range: conflict.rangeA,
      otherMember: conflict.memberB,
      otherRange: conflict.rangeB,
    };
  }
  if (conflict.memberB.isLocal) {
    return {
      range: conflict.rangeB,
      otherMember: conflict.memberA,
      otherRange: conflict.rangeA,
    };
  }
  return undefined;
}

function toEditorRange(range: FileRange, document: vscode.TextDocument): vscode.Range {
  const lastLine = Math.max(0, document.lineCount - 1);
  const startLine = Math.min(Math.max(0, range.startLine - 1), lastLine);
  const endLine = Math.min(Math.max(startLine, range.endLine - 1), lastLine);
  return new vscode.Range(new vscode.Position(startLine, 0), document.lineAt(endLine).range.end);
}

function createHoverMessage(otherMember: Member, otherRange: FileRange): vscode.MarkdownString {
  const message = new vscode.MarkdownString();
  message.appendText(
    `⚠ 衝突: ${otherMember.username}（Lines ${otherRange.startLine}–${otherRange.endLine}）`,
  );
  return message;
}

export class ConflictDecorations implements vscode.Disposable {
  private readonly decorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editorWarning.background'),
    borderColor: new vscode.ThemeColor('editorWarning.foreground'),
    borderStyle: 'solid',
    borderWidth: '0 0 0 2px',
    isWholeLine: true,
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.warningForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });
  private readonly disposables: vscode.Disposable[] = [];
  private decoratedRanges: FileRange[] = [];

  constructor(private readonly treeProvider: CampDiffTreeProvider) {
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.refresh()),
      treeProvider.onDidChangeTreeData(() => this.refresh()),
    );
    this.refresh();
  }

  private refresh(): void {
    const conflicts = this.treeProvider.getConflicts();
    const decoratedRanges = new Map<string, FileRange>();

    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.scheme !== 'file') {
        editor.setDecorations(this.decorationType, []);
        continue;
      }

      const editorFilePath = toPosixPath(vscode.workspace.asRelativePath(editor.document.uri, false));
      const options: vscode.DecorationOptions[] = [];

      for (const conflict of conflicts) {
        const localSide = getLocalConflictSide(conflict);
        if (!localSide || localSide.range.filePath !== editorFilePath) {
          continue;
        }

        options.push({
          range: toEditorRange(localSide.range, editor.document),
          hoverMessage: createHoverMessage(localSide.otherMember, localSide.otherRange),
        });
        const key = `${localSide.range.filePath}\0${localSide.range.startLine}\0${localSide.range.endLine}`;
        decoratedRanges.set(key, { ...localSide.range });
      }

      editor.setDecorations(this.decorationType, options);
    }

    this.decoratedRanges = [...decoratedRanges.values()];
  }

  getDecoratedRanges(): FileRange[] {
    return this.decoratedRanges.map((range) => ({ ...range }));
  }

  dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.decorationType.dispose();
  }
}
