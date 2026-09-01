import assert from 'node:assert/strict';
import * as vscode from 'vscode';

const BACKGROUND_SYNC_TAB = 'camp-diff (background sync)';

suite('packaged extension (installed .vsix, no extensionDevelopmentPath)', () => {
  test('activates from a clean profile without opening a sync tab', async function () {
    this.timeout(60_000);

    const extension = vscode.extensions.getExtension('camp-diff.camp-diff');
    assert.ok(extension, 'the installed camp-diff extension was not found in the clean profile');

    const api = await extension.activate();
    assert.equal(extension.isActive, true, 'the packaged extension failed to activate');
    assert.equal(api, undefined, 'the test-only API must not be exposed outside ExtensionMode.Test');

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('campDiff.setUsername'), 'campDiff.setUsername was not registered');
    assert.ok(commands.includes('campDiff.openLocation'), 'campDiff.openLocation was not registered');

    await new Promise((resolve) => setTimeout(resolve, 1_000));
    assert.equal(
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .some((tab) => tab.label === BACKGROUND_SYNC_TAB),
      false,
      'background sync must not create an editor tab',
    );
  });
});
