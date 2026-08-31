import assert from 'node:assert/strict';
import * as vscode from 'vscode';

const BACKGROUND_SYNC_TAB = 'camp-diff (background sync)';

async function waitUntil(predicate: () => boolean, timeoutMs: number, description: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for: ${description}`);
}

suite('packaged extension (installed .vsix, no extensionDevelopmentPath)', () => {
  test('activates from a clean profile with only the packaged files', async function () {
    this.timeout(60_000);

    const extension = vscode.extensions.getExtension('camp-diff.camp-diff');
    assert.ok(extension, 'the installed camp-diff extension was not found in the clean profile');

    const api = await extension.activate();
    assert.equal(extension.isActive, true, 'the packaged extension failed to activate');
    assert.equal(api, undefined, 'the test-only API must not be exposed outside ExtensionMode.Test');

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('campDiff.setUsername'), 'campDiff.setUsername was not registered');
    assert.ok(commands.includes('campDiff.openLocation'), 'campDiff.openLocation was not registered');

    // Only checks that the background sync panel gets created at all: WebviewBridge recreates a
    // disposed panel with backoff, so a transient tab can still appear when its assets are broken.
    // Missing runtime assets are caught by the packaged-file assertion in runPackageTest.ts.
    await waitUntil(
      () =>
        vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .some((tab) => tab.label === BACKGROUND_SYNC_TAB),
      20_000,
      'the background sync webview tab to stay open',
    );
  });
});
