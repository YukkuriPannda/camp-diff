import * as vscode from 'vscode';
import { CampDiffTreeProvider } from './ui/treeDataProvider';

let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('camp-diff');
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine('camp-diff activated');

  const treeProvider = new CampDiffTreeProvider();
  context.subscriptions.push(vscode.window.registerTreeDataProvider('campDiff.mainView', treeProvider));
}

export function deactivate(): void {
  outputChannel?.appendLine('camp-diff deactivated');
}
