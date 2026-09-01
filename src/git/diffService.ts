import * as vscode from 'vscode';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FileRange } from '../types';
import * as config from '../config';
import { IgnoreService } from '../ignore/ignoreService';
import { GitService } from './gitService';
import { parseUnifiedDiffRanges } from './diffParser';

const execFileAsync = promisify(execFile);

const DEBOUNCE_MS = 300;
const POLL_INTERVAL_MS = 15_000;
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;
const MAX_SHARED_RANGES = 500;
const MAX_UNTRACKED_FILES = 100;
const MAX_UNTRACKED_BYTES = 1024 * 1024;

/**
 * Global options applied to every invocation. `--no-optional-locks` keeps the
 * background polling from writing to the index, and `core.quotePath=false`
 * stops git from octal-escaping non-ASCII paths.
 */
const GIT_GLOBAL_ARGS = ['--no-optional-locks', '-c', 'core.quotePath=false'];

const DIFF_ARGS = [
  'diff',
  '--no-ext-diff',
  '--no-color',
  '--unified=0',
  '--ignore-submodules=all',
];

function toPosixPath(value: string): string {
  return value.split('\\').join('/');
}

export class DiffService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timer: ReturnType<typeof setInterval>;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private runToken = 0;
  private running = false;
  private rerunRequested = false;
  private disposed = false;

  constructor(
    private readonly gitService: GitService,
    private readonly ignoreService: IgnoreService,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly onChange: (ranges: FileRange[]) => void,
  ) {
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument(() => this.scheduleRefresh()),
      vscode.workspace.onDidCreateFiles(() => this.scheduleRefresh()),
      vscode.workspace.onDidDeleteFiles(() => this.scheduleRefresh()),
      vscode.workspace.onDidRenameFiles(() => this.scheduleRefresh()),
      this.gitService.onDidChange(() => this.scheduleRefresh()),
      this.ignoreService.onDidChange(() => this.scheduleRefresh()),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.scheduleRefresh();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('campDiff.diffBase')) {
          this.scheduleRefresh();
        }
      }),
    );

    // Staging, stashing and edits made outside the editor produce no event we
    // can subscribe to, so a slow poll fills the gap while the window is in use.
    this.timer = setInterval(() => {
      if (vscode.window.state.focused) {
        this.scheduleRefresh();
      }
    }, POLL_INTERVAL_MS);

    this.scheduleRefresh();
  }

  refresh(): void {
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (this.disposed) {
      return;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.run();
    }, DEBOUNCE_MS);
  }

  private async run(): Promise<void> {
    if (this.running) {
      this.rerunRequested = true;
      return;
    }
    this.running = true;
    const token = ++this.runToken;

    try {
      const ranges = await this.computeRanges();
      if (token === this.runToken && !this.disposed) {
        this.onChange(ranges);
      }
    } finally {
      this.running = false;
      if (this.rerunRequested && !this.disposed) {
        this.rerunRequested = false;
        this.scheduleRefresh();
      }
    }
  }

  private async computeRanges(): Promise<FileRange[]> {
    const state = this.gitService.getState();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (state.kind !== 'repository' || !workspaceRoot || workspaceRoot.scheme !== 'file') {
      return [];
    }

    const repoRoot = state.rootUri.fsPath;
    const gitPath = this.gitService.getGitPath() ?? 'git';
    const base = await this.resolveBase(gitPath, repoRoot, state.branchName, state.remoteName);

    const diff = await this.runGit(gitPath, repoRoot, [...DIFF_ARGS, base, '--']);
    const tracked = diff === undefined ? [] : parseUnifiedDiffRanges(diff);
    const untracked = await this.collectUntrackedRanges(gitPath, repoRoot);

    const mapped = [...tracked, ...untracked].flatMap((range) => {
      const filePath = this.toSharedPath(repoRoot, workspaceRoot.fsPath, range.filePath);
      return filePath ? [{ ...range, filePath }] : [];
    });

    if (mapped.length <= MAX_SHARED_RANGES) {
      return mapped;
    }
    this.log(`変更範囲が${mapped.length}件あるため、先頭${MAX_SHARED_RANGES}件のみ共有します`);
    return mapped.slice(0, MAX_SHARED_RANGES);
  }

  /**
   * `upstream` compares against the point the branch diverged from its remote
   * counterpart, so locally committed work still counts as in progress. It
   * falls back to HEAD whenever that remote ref is missing.
   */
  private async resolveBase(
    gitPath: string,
    repoRoot: string,
    branchName: string | undefined,
    remoteName: string,
  ): Promise<string> {
    if (config.getDiffBase() !== 'upstream' || !branchName) {
      return 'HEAD';
    }
    const mergeBase = await this.runGit(gitPath, repoRoot, [
      'merge-base',
      'HEAD',
      `${remoteName}/${branchName}`,
    ]);
    return mergeBase?.trim() || 'HEAD';
  }

  /**
   * Untracked files have no counterpart to diff against, so the whole file is
   * reported as one range. `--exclude-standard` keeps .gitignore in effect.
   */
  private async collectUntrackedRanges(gitPath: string, repoRoot: string): Promise<FileRange[]> {
    const output = await this.runGit(gitPath, repoRoot, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
    ]);
    if (!output) {
      return [];
    }

    const paths = output.split('\0').filter((value) => value.length > 0);
    if (paths.length > MAX_UNTRACKED_FILES) {
      this.log(
        `未追跡ファイルが${paths.length}件あるため、先頭${MAX_UNTRACKED_FILES}件のみ対象にします`,
      );
    }

    const ranges: FileRange[] = [];
    for (const filePath of paths.slice(0, MAX_UNTRACKED_FILES)) {
      const lineCount = await this.countLines(vscode.Uri.file(path.resolve(repoRoot, filePath)));
      if (lineCount !== undefined) {
        ranges.push({ filePath, startLine: 1, endLine: lineCount });
      }
    }
    return ranges;
  }

  private async countLines(uri: vscode.Uri): Promise<number | undefined> {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type !== vscode.FileType.File || stat.size > MAX_UNTRACKED_BYTES) {
        return undefined;
      }
      const contents = await vscode.workspace.fs.readFile(uri);
      let lines = 1;
      for (const byte of contents) {
        if (byte === 0) {
          return undefined;
        }
        if (byte === 0x0a) {
          lines += 1;
        }
      }
      // A trailing newline does not start a line anyone can edit.
      const endsWithNewline = contents.length > 0 && contents[contents.length - 1] === 0x0a;
      return Math.max(1, endsWithNewline ? lines - 1 : lines);
    } catch {
      return undefined;
    }
  }

  /**
   * git reports paths relative to the repository root, while the rest of the
   * extension addresses files relative to the workspace folder. Files outside
   * the workspace folder cannot be opened from the tree, so they are dropped.
   */
  private toSharedPath(
    repoRoot: string,
    workspaceRoot: string,
    repoRelativePath: string,
  ): string | undefined {
    const absolute = path.resolve(repoRoot, repoRelativePath);
    const relative = path.relative(workspaceRoot, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return undefined;
    }
    const posixPath = toPosixPath(relative);
    return this.ignoreService.isIgnored(posixPath) ? undefined : posixPath;
  }

  private async runGit(gitPath: string, cwd: string, args: string[]): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync(gitPath, [...GIT_GLOBAL_ARGS, ...args], {
        cwd,
        maxBuffer: MAX_BUFFER_BYTES,
        windowsHide: true,
      });
      return stdout;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.log(`git ${args.join(' ')} に失敗しました: ${reason}`);
      return undefined;
    }
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[diff] ${message}`);
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.timer);
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.disposables.forEach((disposable) => disposable.dispose());
  }
}
