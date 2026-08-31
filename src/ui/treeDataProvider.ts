import * as vscode from 'vscode';
import { FileRange, Member } from '../types';
import { PresenceStore } from '../presence/presenceStore';
import { ConnectionStatusItem, MembersSectionItem, MemberItem, MemberFileItem } from './treeItems';
import { RepositoryStatusItem } from './treeItems';
import { GitWorkspaceState } from '../git/gitService';

type CampDiffTreeElement =
  | { type: 'connectionStatus' }
  | { type: 'repositoryStatus' }
  | { type: 'membersSection' }
  | { type: 'member'; member: Member }
  | { type: 'memberFile'; member: Member; range: FileRange };

export class CampDiffTreeProvider implements vscode.TreeDataProvider<CampDiffTreeElement> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private connected = false;

  constructor(
    private readonly presenceStore: PresenceStore,
    private gitState: GitWorkspaceState,
  ) {
    presenceStore.onDidChange(() => this.onDidChangeTreeDataEmitter.fire());
  }

  setGitState(gitState: GitWorkspaceState): void {
    this.gitState = gitState;
    this.onDidChangeTreeDataEmitter.fire();
  }

  setConnected(connected: boolean): void {
    if (this.connected === connected) {
      return;
    }
    this.connected = connected;
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: CampDiffTreeElement): vscode.TreeItem {
    switch (element.type) {
      case 'connectionStatus':
        return new ConnectionStatusItem(this.connected);
      case 'repositoryStatus':
        return new RepositoryStatusItem(this.gitState);
      case 'membersSection':
        return new MembersSectionItem(this.presenceStore.getMembers().length);
      case 'member':
        return new MemberItem(element.member);
      case 'memberFile':
        return new MemberFileItem(element.member, element.range);
    }
  }

  getChildren(element?: CampDiffTreeElement): CampDiffTreeElement[] {
    if (!element) {
      return [{ type: 'connectionStatus' }, { type: 'repositoryStatus' }, { type: 'membersSection' }];
    }
    if (element.type === 'membersSection') {
      return this.presenceStore.getMembers().map((member) => ({ type: 'member', member }));
    }
    if (element.type === 'member') {
      return element.member.files.map((range) => ({ type: 'memberFile', member: element.member, range }));
    }
    return [];
  }
}
