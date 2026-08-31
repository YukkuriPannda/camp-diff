import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CampDiffTestApi } from '../../../src/extension';
import { FileRange, Member, PresenceState } from '../../../src/types';

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

async function readFakePeerObservedFiles(statusFilePath: string): Promise<FileRange[]> {
  const raw = await fs.readFile(statusFilePath, 'utf8').catch(() => '[]');
  const states = JSON.parse(raw) as Array<{ presence?: PresenceState } | undefined>;
  return states.flatMap((state) => state?.presence?.files ?? []);
}

suite('camp-diff P2P bridge (real WebRTC via a fake peer)', () => {
  test('exchanges presence with an independent y-webrtc peer through the hidden webview bridge', async function () {
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
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(2, 0, 4, 0);

    await waitUntil(
      async () => {
        const files = await readFakePeerObservedFiles(statusFilePath);
        return files.some((range) => range.filePath === 'sample.ts');
      },
      60_000,
      'fake peer to observe the extension local presence via awareness',
    );

    await waitUntil(
      () => api.getMembers().some((member: Member) => member.id === fakePeerId),
      60_000,
      'extension to observe the fake peer via the hidden webview bridge',
    );

    const members = api.getMembers();
    const fakeMember = members.find((member) => member.id === fakePeerId);
    assert.ok(fakeMember, 'fake peer member missing from getMembers()');
    assert.equal(fakeMember.username, fakePeerUsername);
    assert.equal(fakeMember.isLocal, false);
    assert.deepEqual(fakeMember.files, [fakePeerRange]);

    await waitUntil(() => api.getConflicts().length === 1, 10_000, 'tree provider to detect the overlapping ranges');
    const [conflict] = api.getConflicts();
    assert.equal(conflict.filePath, 'sample.ts');
    assert.deepEqual(api.getTreeRootTypes(), ['connectionStatus', 'repositoryStatus', 'conflictsSection', 'membersSection']);

    editor.selection = new vscode.Selection(15, 0, 17, 0);
    await waitUntil(() => api.getConflicts().length === 0, 10_000, 'tree provider to clear the resolved conflict');
    assert.deepEqual(api.getTreeRootTypes(), ['connectionStatus', 'repositoryStatus', 'membersSection']);
  });
});
