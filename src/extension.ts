import * as vscode from 'vscode';
import { CampDiffTreeProvider } from './ui/treeDataProvider';
import { registerCommands } from './ui/commands';
import { PresenceStore } from './presence/presenceStore';
import { IdentityService } from './identity/identityService';
import { IgnoreService } from './ignore/ignoreService';
import { WebviewBridge } from './net/webviewBridge';
import { ConflictInfo, FileRange, Member } from './types';
import { GitService, GitWorkspaceState } from './git/gitService';
import { DiffService } from './git/diffService';
import { computeRoomKey } from './git/roomKey';
import { getRemoteName } from './config';
import { ConflictDecorations } from './ui/decorations';

let outputChannel: vscode.OutputChannel;

export interface CampDiffTestApi {
  getMembers(): Member[];
  getConflicts(): ConflictInfo[];
  getDecoratedRanges(): FileRange[];
  getTreeRootTypes(): string[];
  isConnected(): boolean;
  setRangeRequested(peerId: string, filePath: string, requested: boolean): void;
}

function getRoomKey(state: GitWorkspaceState): string | undefined {
  return state.kind === 'repository'
    ? computeRoomKey(state.remoteUrl, state.branchName, state.commitHash)
    : undefined;
}

export async function activate(context: vscode.ExtensionContext): Promise<CampDiffTestApi | void> {
  outputChannel = vscode.window.createOutputChannel('camp-diff');
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine('camp-diff activated');

  const presenceStore = new PresenceStore();
  context.subscriptions.push(presenceStore);

  const gitService = new GitService(getRemoteName());
  context.subscriptions.push(gitService);
  await gitService.initialize();

  const treeProvider = new CampDiffTreeProvider(presenceStore, gitService.getState());
  const treeView = vscode.window.createTreeView('campDiff.mainView', { treeDataProvider: treeProvider });
  context.subscriptions.push(treeProvider, treeView);

  const decorations = new ConflictDecorations(treeProvider);
  context.subscriptions.push(decorations);

  const webviewBridge = new WebviewBridge(
    context,
    getRoomKey(gitService.getState()),
    presenceStore.getLocalPresence(),
    (peers) => presenceStore.setRemotePresence(peers),
    outputChannel,
  );
  context.subscriptions.push(
    webviewBridge,
    treeView.onDidExpandElement(({ element }) => {
      if (element.type === 'memberFile' && !element.member.isLocal) {
        webviewBridge.setRangeRequested(element.member.id, element.filePath, true);
      }
    }),
    treeView.onDidCollapseElement(({ element }) => {
      if (element.type === 'memberFile' && !element.member.isLocal) {
        webviewBridge.setRangeRequested(element.member.id, element.filePath, false);
      }
    }),
    webviewBridge.onDidChangeConnection((connected) => treeProvider.setConnected(connected)),
    presenceStore.onDidChangeLocal((presence) => webviewBridge.updateLocalPresence(presence)),
    gitService.onDidChange((state) => {
      treeProvider.setGitState(state);
      webviewBridge.updateRoomKey(getRoomKey(state));
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('campDiff.remoteName')) {
        gitService.setRemoteName(getRemoteName());
      }
    }),
  );

  const identityService = new IdentityService();
  void identityService.resolveUsername().then((username) => {
    presenceStore.setUsername(username);
  });

  const ignoreService = new IgnoreService(vscode.workspace.workspaceFolders?.[0]?.uri);
  context.subscriptions.push(ignoreService);
  await ignoreService.initialize();

  // Uncommitted changes stay relevant to everyone else for as long as they
  // exist, so ranges are advertised until the diff itself no longer reports
  // them. Peers that actually go away are dropped by the awareness heartbeat.
  const diffService = new DiffService(gitService, ignoreService, outputChannel, (ranges) => {
    presenceStore.setLocalFiles(ranges);
  });
  context.subscriptions.push(
    diffService,
    vscode.commands.registerCommand('campDiff.refresh', () => diffService.refresh()),
  );

  registerCommands(context, identityService, presenceStore);

  if (context.extensionMode === vscode.ExtensionMode.Test) {
    return {
      getMembers: () => presenceStore.getMembers(),
      getConflicts: () => treeProvider.getConflicts(),
      getDecoratedRanges: () => decorations.getDecoratedRanges(),
      getTreeRootTypes: () => treeProvider.getChildren().map((element) => element.type),
      isConnected: () => webviewBridge.isConnected,
      setRangeRequested: (peerId, filePath, requested) =>
        webviewBridge.setRangeRequested(peerId, filePath, requested),
    };
  }
}

export function deactivate(): void {
  outputChannel?.appendLine('camp-diff deactivated');
}
