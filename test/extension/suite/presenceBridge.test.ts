import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CampDiffTestApi } from '../../../src/extension';
import { FileRange, Member, SharedPresenceState } from '../../../src/types';

async function waitUntil(predicate: () => Promise<boolean> | boolean, timeoutMs: number, description: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for: ${description}`);
}

/**
 * Presence is derived from the git diff, so a range is produced by changing
 * and saving the file rather than by moving the selection.
 */
async function replaceLines(
  document: vscode.TextDocument,
  startLine: number,
  endLine: number,
  text: string,
): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length),
    text,
  );
  assert.ok(await vscode.workspace.applyEdit(edit), 'failed to apply the test edit');
  assert.ok(await document.save(), 'failed to save the test edit');
}

async function readFakePeerObservedFiles(statusFilePath: string): Promise<FileRange[]> {
  const raw = await fs.readFile(statusFilePath, 'utf8').catch(() => '[]');
  const states = JSON.parse(raw) as Array<{ presence?: SharedPresenceState } | undefined>;
  return states.flatMap((state) => state?.presence?.ranges ?? []);
}

async function readFakePeerObservedFilePaths(statusFilePath: string): Promise<string[]> {
  const raw = await fs.readFile(statusFilePath, 'utf8').catch(() => '[]');
  const states = JSON.parse(raw) as Array<{ presence?: SharedPresenceState } | undefined>;
  return states.flatMap((state) => state?.presence?.filePaths ?? []);
}

suite('camp-diff presence relay (real WebSocket via a fake peer)', () => {
  test('exchanges presence with an independent relay peer without opening a webview', async function () {
    this.timeout(90_000);

    const signalingUrl = process.env.CAMP_DIFF_TEST_SIGNALING_URL;
    const fakePeerId = process.env.CAMP_DIFF_TEST_FAKE_PEER_ID;
    const fakePeerUsername = process.env.CAMP_DIFF_TEST_FAKE_PEER_USERNAME;
    const fakePeerRangeJson = process.env.CAMP_DIFF_TEST_FAKE_PEER_RANGE;
    const statusFilePath = process.env.CAMP_DIFF_TEST_STATUS_FILE;
    assert.ok(
      signalingUrl && fakePeerId && fakePeerUsername && fakePeerRangeJson && statusFilePath,
      'test runner did not set required env vars',
    );
    const fakePeerRange = JSON.parse(fakePeerRangeJson) as FileRange;

    const config = vscode.workspace.getConfiguration('campDiff');
    await config.update('username', 'IntegrationTestUser', vscode.ConfigurationTarget.Global);
    await config.update('signalingServerUrls', [signalingUrl], vscode.ConfigurationTarget.Global);
    await config.update('conflictProximityLines', 3, vscode.ConfigurationTarget.Global);

    const extension = vscode.extensions.getExtension<CampDiffTestApi>('camp-diff.camp-diff');
    assert.ok(extension, 'camp-diff extension not found');
    const api = await extension.activate();
    assert.ok(api, 'extension did not return a test API (extensionMode must be Test)');

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder, 'no workspace folder open');
    const sampleUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, 'sample.ts'));
    const document = await vscode.workspace.openTextDocument(sampleUri);
    await vscode.window.showTextDocument(document);
    await replaceLines(
      document,
      2,
      4,
      'const line3 = 300;\nconst line4 = 400;\nconst line5 = 500;',
    );

    await waitUntil(
      async () => {
        const filePaths = await readFakePeerObservedFilePaths(statusFilePath);
        return filePaths.includes('sample.ts');
      },
      60_000,
      'fake peer to observe the extension file summary via the relay',
    );
    assert.deepEqual(
      await readFakePeerObservedFiles(statusFilePath),
      [],
      'line ranges must stay private until the fake peer requests them',
    );

    await waitUntil(
      () => api.getMembers().some((member: Member) => member.id === fakePeerId),
      60_000,
      'extension host to observe the fake peer',
    );

    const members = api.getMembers();
    const fakeMember = members.find((member) => member.id === fakePeerId);
    assert.ok(fakeMember, 'fake peer member missing from getMembers()');
    assert.equal(fakeMember.username, fakePeerUsername);
    assert.equal(fakeMember.isLocal, false);
    assert.deepEqual(fakeMember.filePaths, [fakePeerRange.filePath, 'peer-other.ts']);
    assert.deepEqual(fakeMember.files, []);
    assert.deepEqual(fakeMember.detailedFilePaths, []);

    api.setRangeRequested(fakePeerId, fakePeerRange.filePath, true);
    await waitUntil(
      () =>
        api
          .getMembers()
          .some(
            (member) =>
              member.id === fakePeerId && member.detailedFilePaths.includes(fakePeerRange.filePath),
          ),
      10_000,
      'fake peer to reveal ranges after its file row is expanded',
    );
    const expandedFakeMember = api.getMembers().find((member) => member.id === fakePeerId);
    assert.ok(expandedFakeMember);
    assert.deepEqual(expandedFakeMember.files, [fakePeerRange]);
    assert.deepEqual(expandedFakeMember.detailedFilePaths, [fakePeerRange.filePath]);

    await waitUntil(() => api.getConflicts().length === 1, 10_000, 'tree provider to detect the overlapping ranges');
    const [conflict] = api.getConflicts();
    assert.equal(conflict.filePath, 'sample.ts');
    assert.deepEqual(api.getTreeRootTypes(), ['connectionStatus', 'repositoryStatus', 'conflictsSection', 'membersSection']);
    await waitUntil(
      () => api.getDecoratedRanges().length === 1,
      10_000,
      'decorations to target the local side of the conflict',
    );
    assert.deepEqual(api.getDecoratedRanges(), [{ filePath: 'sample.ts', startLine: 3, endLine: 5 }]);

    api.setRangeRequested(fakePeerId, fakePeerRange.filePath, false);
    await waitUntil(
      () =>
        api
          .getMembers()
          .some(
            (member) =>
              member.id === fakePeerId && !member.detailedFilePaths.includes(fakePeerRange.filePath),
          ),
      10_000,
      'fake peer ranges to be hidden after its file row is collapsed',
    );
    await waitUntil(() => api.getConflicts().length === 0, 10_000, 'conflict to clear when details are hidden');

    // Undo the overlapping change and move the edit clear of the peer range.
    await replaceLines(document, 2, 4, 'const line3 = 3;\nconst line4 = 4;\nconst line5 = 5;');
    await replaceLines(
      document,
      15,
      17,
      'const line16 = 1600;\nconst line17 = 1700;\nconst line18 = 1800;',
    );
    await waitUntil(() => api.getConflicts().length === 0, 10_000, 'tree provider to clear the resolved conflict');
    await waitUntil(() => api.getDecoratedRanges().length === 0, 10_000, 'decorations to clear the resolved conflict');
    assert.deepEqual(api.getTreeRootTypes(), ['connectionStatus', 'repositoryStatus', 'membersSection']);
  });
});
