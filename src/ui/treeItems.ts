import * as vscode from 'vscode';
import { FileRange, Member } from '../types';

export class ConnectionStatusItem extends vscode.TreeItem {
  constructor(connected: boolean) {
    super(connected ? '● Connected' : '○ Offline (local only)', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'campDiff.connectionStatus';
  }
}

export class MembersSectionItem extends vscode.TreeItem {
  constructor(memberCount: number) {
    super('MEMBERS', vscode.TreeItemCollapsibleState.Expanded);
    this.description = String(memberCount);
    this.contextValue = 'campDiff.membersSection';
  }
}

export class MemberItem extends vscode.TreeItem {
  constructor(readonly member: Member) {
    super(member.isLocal ? 'You' : member.username, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'campDiff.member';
  }
}

export class MemberFileItem extends vscode.TreeItem {
  constructor(
    readonly member: Member,
    readonly range: FileRange,
  ) {
    super(range.filePath, vscode.TreeItemCollapsibleState.None);
    this.description = `L${range.startLine}-${range.endLine}`;
    this.contextValue = 'campDiff.memberFile';
    this.command = {
      command: 'campDiff.openLocation',
      title: 'Open Location',
      arguments: [range],
    };
  }
}
