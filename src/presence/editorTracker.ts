import * as vscode from 'vscode';
import { FileRange } from '../types';
import * as config from '../config';

function toPosixPath(p: string): string {
  return p.split('\\').join('/');
}

export class EditorTracker implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private cursorContextLines = config.getCursorContextLines();

  constructor(private readonly onChange: (ranges: FileRange[]) => void) {
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection(() => this.publish()),
      vscode.window.onDidChangeActiveTextEditor(() => this.publish()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('campDiff.cursorContextLines')) {
          this.cursorContextLines = config.getCursorContextLines();
          this.publish();
        }
      }),
    );
    this.publish();
  }

  private publish(): void {
    this.onChange(this.computeRanges());
  }

  private computeRanges(): FileRange[] {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      return [];
    }
    if (!vscode.workspace.getWorkspaceFolder(editor.document.uri)) {
      return [];
    }

    const filePath = toPosixPath(vscode.workspace.asRelativePath(editor.document.uri, false));
    const selection = editor.selection;
    const lastLine = editor.document.lineCount - 1;

    if (!selection.isEmpty) {
      return [
        {
          filePath,
          startLine: selection.start.line + 1,
          endLine: selection.end.line + 1,
        },
      ];
    }

    const line = selection.active.line;
    return [
      {
        filePath,
        startLine: Math.max(0, line - this.cursorContextLines) + 1,
        endLine: Math.min(lastLine, line + this.cursorContextLines) + 1,
      },
    ];
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
