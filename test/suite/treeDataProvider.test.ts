import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { PresenceStore } from '../../src/presence/presenceStore';
import { CampDiffTreeProvider } from '../../src/ui/treeDataProvider';
import { FileRange } from '../../src/types';
import { GitWorkspaceState } from '../../src/git/gitService';

const NO_REPOSITORY_STATE: GitWorkspaceState = { kind: 'noRepository', workspaceName: 'test-workspace' };

suite('CampDiffTreeProvider', () => {
  test('衝突セクションと警告アイコンを表示し、解消後はセクションを隠す', async () => {
    const config = vscode.workspace.getConfiguration('campDiff');
    await config.update('conflictProximityLines', 3, vscode.ConfigurationTarget.Global);

    const localRange: FileRange = { filePath: 'src/auth.ts', startLine: 42, endLine: 50 };
    const remoteRange: FileRange = { filePath: 'src/auth.ts', startLine: 48, endLine: 68 };
    const store = new PresenceStore();
    store.setUsername('LocalUser');
    store.setLocalFiles([localRange]);
    const provider = new CampDiffTreeProvider(store, NO_REPOSITORY_STATE);

    try {
      assert.deepEqual(
        provider.getChildren().map((element) => element.type),
        ['connectionStatus', 'repositoryStatus', 'membersSection'],
      );

      store.setRemotePresence([
        {
          id: 'tanaka-peer',
          username: 'Tanaka',
          filePaths: [remoteRange.filePath],
          rangeRequests: [],
          updatedAt: Date.now(),
        },
      ]);

      assert.deepEqual(
        provider.getChildren().map((element) => element.type),
        ['connectionStatus', 'repositoryStatus', 'membersSection'],
      );
      const membersSectionWithoutDetails = provider
        .getChildren()
        .find((element) => element.type === 'membersSection');
      assert.ok(membersSectionWithoutDetails);
      const remoteMemberWithoutDetails = provider
        .getChildren(membersSectionWithoutDetails)
        .find((element) => element.type === 'member' && !element.member.isLocal);
      assert.ok(remoteMemberWithoutDetails && remoteMemberWithoutDetails.type === 'member');
      const [summaryFileElement] = provider.getChildren(remoteMemberWithoutDetails);
      assert.ok(summaryFileElement && summaryFileElement.type === 'memberFile');
      const summaryFileItem = provider.getTreeItem(summaryFileElement);
      assert.equal(summaryFileItem.label, remoteRange.filePath);
      assert.equal(summaryFileItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
      const [loadingElement] = provider.getChildren(summaryFileElement);
      assert.ok(loadingElement && loadingElement.type === 'memberLoading');
      assert.equal(provider.getTreeItem(loadingElement).label, 'Loading lines…');
      assert.equal(summaryFileItem.command, undefined);

      store.setRemotePresence([
        {
          id: 'tanaka-peer',
          username: 'Tanaka',
          filePaths: [remoteRange.filePath],
          ranges: [remoteRange],
          rangeRequests: [],
          updatedAt: Date.now(),
        },
      ]);

      const root = provider.getChildren();
      assert.deepEqual(
        root.map((element) => element.type),
        ['connectionStatus', 'repositoryStatus', 'conflictsSection', 'membersSection'],
      );

      const conflictsSection = root.find((element) => element.type === 'conflictsSection');
      assert.ok(conflictsSection);
      const sectionItem = provider.getTreeItem(conflictsSection);
      assert.equal(sectionItem.label, 'CONFLICTS');
      assert.equal(sectionItem.description, '1');

      const [conflictElement] = provider.getChildren(conflictsSection);
      assert.ok(conflictElement && conflictElement.type === 'conflict');
      const conflictItem = provider.getTreeItem(conflictElement);
      assert.equal(conflictItem.label, 'src/auth.ts · Lines 42–68');
      assert.equal(conflictItem.description, 'You ↔ Tanaka');
      assert.ok(conflictItem.iconPath instanceof vscode.ThemeIcon);
      assert.equal(conflictItem.iconPath.id, 'warning');
      assert.deepEqual(conflictItem.command?.arguments, [localRange]);

      const membersSection = root.find((element) => element.type === 'membersSection');
      assert.ok(membersSection);
      const members = provider.getChildren(membersSection);
      for (const member of members) {
        assert.equal(member.type, 'member');
        if (member.type !== 'member') {
          continue;
        }
        const [fileElement] = provider.getChildren(member);
        assert.ok(fileElement && fileElement.type === 'memberFile');
        const fileItem = provider.getTreeItem(fileElement);
        assert.ok(fileItem.iconPath instanceof vscode.ThemeIcon);
        assert.equal(fileItem.iconPath.id, 'warning');
        const [rangeElement] = provider.getChildren(fileElement);
        assert.ok(rangeElement && rangeElement.type === 'memberRange');
        const rangeItem = provider.getTreeItem(rangeElement);
        assert.match(String(rangeItem.label), /^Lines \d+–\d+$/);
        assert.ok(rangeItem.iconPath instanceof vscode.ThemeIcon);
        assert.equal(rangeItem.iconPath.id, 'warning');
        assert.deepEqual(rangeItem.command?.arguments, [rangeElement.range]);
      }

      store.setRemotePresence([
        {
          id: 'tanaka-peer',
          username: 'Tanaka',
          filePaths: ['src/auth.ts'],
          ranges: [{ filePath: 'src/auth.ts', startLine: 80, endLine: 90 }],
          rangeRequests: [],
          updatedAt: Date.now() + 1,
        },
      ]);

      assert.equal(provider.getConflicts().length, 0);
      assert.deepEqual(
        provider.getChildren().map((element) => element.type),
        ['connectionStatus', 'repositoryStatus', 'membersSection'],
      );
    } finally {
      provider.dispose();
      store.dispose();
    }
  });
});
