import * as vscode from 'vscode';
import * as path from 'node:path';
import { FileRange } from '../types';
import { IdentityService } from '../identity/identityService';
import { PresenceStore } from '../presence/presenceStore';

export function registerCommands(
  context: vscode.ExtensionContext,
  identityService: IdentityService,
  presenceStore: PresenceStore,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('campDiff.openLocation', async (range: FileRange) => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        return;
      }
      const uri = vscode.Uri.file(path.join(folder.uri.fsPath, range.filePath));
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);

      const startLine = Math.min(range.startLine - 1, document.lineCount - 1);
      const endLine = Math.min(range.endLine - 1, document.lineCount - 1);
      const start = new vscode.Position(startLine, 0);
      const end = document.lineAt(endLine).range.end;

      editor.selection = new vscode.Selection(start, end);
      editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
    }),

    vscode.commands.registerCommand('campDiff.setUsername', async () => {
      const username = await identityService.promptForUsername();
      presenceStore.setUsername(username);
    }),
  );
}
