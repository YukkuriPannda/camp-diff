import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { GitWorkspaceState } from '../../src/git/gitService';
import { PresenceStore } from '../../src/presence/presenceStore';
import { FileRange } from '../../src/types';
import { ConflictDecorations } from '../../src/ui/decorations';
import { CampDiffTreeProvider } from '../../src/ui/treeDataProvider';

const NO_REPOSITORY_STATE: GitWorkspaceState = { kind: 'noRepository', workspaceName: 'test-workspace' };

function toPosixPath(filePath: string): string {
  return filePath.split('\\').join('/');
}

async function waitUntil(predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for: ${description}`);
}

suite('ConflictDecorations', () => {
  test('表示中ファイルのローカル衝突範囲を装飾し、衝突解消で消す', async () => {
    const config = vscode.workspace.getConfiguration('campDiff');
    await config.update('conflictProximityLines', 3, vscode.ConfigurationTarget.Global);

    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'camp-diff-decorations-'));
    const fileUri = vscode.Uri.file(path.join(tempDirectory, 'sample.ts'));
    await fs.writeFile(fileUri.fsPath, 'line 1\nline 2\nline 3\nline 4\nline 5\n', 'utf8');
    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document);

    const localRange: FileRange = {
      filePath: toPosixPath(vscode.workspace.asRelativePath(fileUri, false)),
      startLine: 2,
      endLine: 3,
    };
    const store = new PresenceStore();
    store.setUsername('LocalUser');
    store.setLocalFiles([localRange]);
    const provider = new CampDiffTreeProvider(store, NO_REPOSITORY_STATE);
    const decorations = new ConflictDecorations(provider);

    try {
      assert.deepEqual(decorations.getDecoratedRanges(), []);

      store.setRemotePresence([
        {
          id: 'tanaka-peer',
          username: 'Tanaka',
          files: [{ ...localRange, startLine: 3, endLine: 4 }],
          updatedAt: Date.now(),
        },
      ]);

      await waitUntil(() => decorations.getDecoratedRanges().length === 1, 'conflict decoration to appear');
      assert.deepEqual(decorations.getDecoratedRanges(), [localRange]);

      store.setRemotePresence([
        {
          id: 'tanaka-peer',
          username: 'Tanaka',
          files: [{ ...localRange, startLine: 10, endLine: 11 }],
          updatedAt: Date.now() + 1,
        },
      ]);

      await waitUntil(() => decorations.getDecoratedRanges().length === 0, 'resolved decoration to disappear');
    } finally {
      decorations.dispose();
      provider.dispose();
      store.dispose();
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await fs.rm(tempDirectory, { recursive: true, force: true });
    }
  });
});
