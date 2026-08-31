import * as vscode from 'vscode';
import { CampDiffTreeProvider } from './ui/treeDataProvider';
import { registerCommands } from './ui/commands';
import { PresenceStore } from './presence/presenceStore';
import { EditorTracker } from './presence/editorTracker';
import { LocalStaleness } from './presence/staleness';
import { IdentityService } from './identity/identityService';
import { IgnoreService } from './ignore/ignoreService';
import { WebviewBridge } from './net/webviewBridge';
import { Member } from './types';

let outputChannel: vscode.OutputChannel;

export interface CampDiffTestApi {
  getMembers(): Member[];
  isConnected(): boolean;
}

export async function activate(context: vscode.ExtensionContext): Promise<CampDiffTestApi | void> {
  outputChannel = vscode.window.createOutputChannel('camp-diff');
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine('camp-diff activated');

  const presenceStore = new PresenceStore();
  context.subscriptions.push(presenceStore);

  const treeProvider = new CampDiffTreeProvider(presenceStore);
  context.subscriptions.push(vscode.window.registerTreeDataProvider('campDiff.mainView', treeProvider));

  const webviewBridge = new WebviewBridge(
    context,
    presenceStore.getLocalPresence(),
    (peers) => presenceStore.setRemotePresence(peers),
    outputChannel,
  );
  context.subscriptions.push(
    webviewBridge,
    webviewBridge.onDidChangeConnection((connected) => treeProvider.setConnected(connected)),
    presenceStore.onDidChangeLocal((presence) => webviewBridge.updateLocalPresence(presence)),
  );

  const identityService = new IdentityService();
  void identityService.resolveUsername().then((username) => {
    presenceStore.setUsername(username);
  });

  const staleness = new LocalStaleness(() => presenceStore.clearLocalFiles());
  context.subscriptions.push(staleness);

  const ignoreService = new IgnoreService(vscode.workspace.workspaceFolders?.[0]?.uri);
  context.subscriptions.push(ignoreService);
  await ignoreService.initialize();

  const editorTracker = new EditorTracker(ignoreService, (ranges) => {
    presenceStore.setLocalFiles(ranges);
    staleness.touch();
  });
  context.subscriptions.push(editorTracker);

  registerCommands(context, identityService, presenceStore);

  if (context.extensionMode === vscode.ExtensionMode.Test) {
    return {
      getMembers: () => presenceStore.getMembers(),
      isConnected: () => webviewBridge.isConnected,
    };
  }
}

export function deactivate(): void {
  outputChannel?.appendLine('camp-diff deactivated');
}
