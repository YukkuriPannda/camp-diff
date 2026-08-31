import * as path from 'node:path';
import * as vscode from 'vscode';

interface GitBranch {
  readonly name?: string;
  readonly commit?: string;
}

interface GitRemote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: {
    readonly HEAD?: GitBranch;
    readonly remotes: GitRemote[];
    readonly onDidChange: vscode.Event<void>;
  };
}

interface GitApi {
  readonly repositories: GitRepository[];
  readonly onDidOpenRepository: vscode.Event<GitRepository>;
  readonly onDidCloseRepository: vscode.Event<GitRepository>;
  readonly onDidChangeState?: vscode.Event<string>;
}

interface GitExtensionExports {
  readonly enabled: boolean;
  readonly onDidChangeEnablement?: vscode.Event<boolean>;
  getAPI(version: 1): GitApi;
}

export type GitWorkspaceState =
  | { readonly kind: 'extensionMissing'; readonly workspaceName?: string }
  | { readonly kind: 'extensionDisabled'; readonly workspaceName?: string }
  | { readonly kind: 'noRepository'; readonly workspaceName?: string }
  | {
      readonly kind: 'repository';
      readonly workspaceName?: string;
      readonly rootUri: vscode.Uri;
      readonly remoteName: string;
      readonly remoteUrl?: string;
      readonly branchName?: string;
      readonly commitHash?: string;
    };

function statesEqual(left: GitWorkspaceState, right: GitWorkspaceState): boolean {
  if (left.kind !== right.kind || left.workspaceName !== right.workspaceName) {
    return false;
  }
  if (left.kind !== 'repository' || right.kind !== 'repository') {
    return true;
  }
  return (
    left.rootUri.toString() === right.rootUri.toString() &&
    left.remoteName === right.remoteName &&
    left.remoteUrl === right.remoteUrl &&
    left.branchName === right.branchName &&
    left.commitHash === right.commitHash
  );
}

export class GitService implements vscode.Disposable {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<GitWorkspaceState>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  private readonly disposables: vscode.Disposable[] = [];
  private apiDisposables: vscode.Disposable[] = [];
  private repositoryListener: vscode.Disposable | undefined;
  private api: GitApi | undefined;
  private repository: GitRepository | undefined;
  private state: GitWorkspaceState;

  constructor(private remoteName: string) {
    this.state = { kind: 'noRepository', workspaceName: this.getWorkspaceName() };
  }

  async initialize(): Promise<void> {
    const extension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
    if (!extension) {
      this.setState({ kind: 'extensionMissing', workspaceName: this.getWorkspaceName() });
      return;
    }

    let gitExtension: GitExtensionExports;
    try {
      gitExtension = await extension.activate();
    } catch {
      this.setState({ kind: 'extensionDisabled', workspaceName: this.getWorkspaceName() });
      return;
    }

    if (gitExtension.onDidChangeEnablement) {
      this.disposables.push(
        gitExtension.onDidChangeEnablement((enabled) => {
          if (enabled) {
            this.attachApi(gitExtension.getAPI(1));
          } else {
            this.detachApi();
            this.setState({ kind: 'extensionDisabled', workspaceName: this.getWorkspaceName() });
          }
        }),
      );
    }
    if (!gitExtension.enabled) {
      this.setState({ kind: 'extensionDisabled', workspaceName: this.getWorkspaceName() });
      return;
    }
    this.attachApi(gitExtension.getAPI(1));
  }

  getState(): GitWorkspaceState {
    return this.state;
  }

  setRemoteName(remoteName: string): void {
    if (this.remoteName === remoteName) {
      return;
    }
    this.remoteName = remoteName;
    this.refreshState();
  }

  private getWorkspaceName(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.name;
  }

  private attachApi(api: GitApi): void {
    this.detachApi();
    this.api = api;
    this.apiDisposables = [
      api.onDidOpenRepository(() => this.selectRepository()),
      api.onDidCloseRepository(() => this.selectRepository()),
    ];
    if (api.onDidChangeState) {
      this.apiDisposables.push(api.onDidChangeState(() => this.selectRepository()));
    }
    this.selectRepository();
  }

  private detachApi(): void {
    this.repositoryListener?.dispose();
    this.repositoryListener = undefined;
    this.repository = undefined;
    for (const disposable of this.apiDisposables) {
      disposable.dispose();
    }
    this.apiDisposables = [];
    this.api = undefined;
  }

  private selectRepository(): void {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const repository = workspaceFolder ? this.findRepository(workspaceFolder.uri) : undefined;
    if (repository !== this.repository) {
      this.repositoryListener?.dispose();
      this.repository = repository;
      this.repositoryListener = repository?.state.onDidChange(() => this.refreshState());
    }
    this.refreshState();
  }

  private findRepository(workspaceUri: vscode.Uri): GitRepository | undefined {
    if (!this.api || workspaceUri.scheme !== 'file') {
      return undefined;
    }
    const workspacePath = path.resolve(workspaceUri.fsPath);
    return this.api.repositories.find((repository) => {
      const rootPath = path.resolve(repository.rootUri.fsPath);
      const relative = path.relative(rootPath, workspacePath);
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    });
  }

  private refreshState(): void {
    const workspaceName = this.getWorkspaceName();
    if (!this.repository) {
      this.setState({ kind: 'noRepository', workspaceName });
      return;
    }
    const remote = this.repository.state.remotes.find((candidate) => candidate.name === this.remoteName);
    const head = this.repository.state.HEAD;
    this.setState({
      kind: 'repository',
      workspaceName,
      rootUri: this.repository.rootUri,
      remoteName: this.remoteName,
      remoteUrl: remote?.fetchUrl ?? remote?.pushUrl,
      branchName: head?.name,
      commitHash: head?.commit,
    });
  }

  private setState(state: GitWorkspaceState): void {
    if (statesEqual(this.state, state)) {
      return;
    }
    this.state = state;
    this.onDidChangeEmitter.fire(state);
  }

  dispose(): void {
    this.detachApi();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.onDidChangeEmitter.dispose();
  }
}
