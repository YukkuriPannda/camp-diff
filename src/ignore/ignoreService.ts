import * as vscode from 'vscode';
import { createIgnoreMatcher } from './ignoreMatcher';

const IGNORE_FILE = '.campdiffignore';

export class IgnoreService implements vscode.Disposable {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  private readonly disposables: vscode.Disposable[] = [];
  private matcher = createIgnoreMatcher([]);
  private reloadVersion = 0;

  constructor(private readonly workspaceRoot: vscode.Uri | undefined) {
    if (!workspaceRoot) {
      return;
    }

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceRoot, IGNORE_FILE),
    );
    const reload = () => {
      void this.reload();
    };
    this.disposables.push(
      watcher,
      watcher.onDidCreate(reload),
      watcher.onDidChange(reload),
      watcher.onDidDelete(reload),
    );
  }

  async initialize(): Promise<void> {
    await this.reload();
  }

  isIgnored(relativePosixPath: string): boolean {
    return this.matcher(relativePosixPath);
  }

  private async reload(): Promise<void> {
    const version = ++this.reloadVersion;
    let matcher = this.matcher;

    if (!this.workspaceRoot) {
      matcher = createIgnoreMatcher([]);
    } else {
      try {
        const uri = vscode.Uri.joinPath(this.workspaceRoot, IGNORE_FILE);
        const contents = await vscode.workspace.fs.readFile(uri);
        const patterns = new TextDecoder().decode(contents).split(/\r?\n/);
        matcher = createIgnoreMatcher(patterns);
      } catch (error) {
        if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
          matcher = createIgnoreMatcher([]);
        }
      }
    }

    if (version !== this.reloadVersion) {
      return;
    }
    this.matcher = matcher;
    this.onDidChangeEmitter.fire();
  }

  dispose(): void {
    this.reloadVersion += 1;
    this.disposables.forEach((disposable) => disposable.dispose());
    this.onDidChangeEmitter.dispose();
  }
}
