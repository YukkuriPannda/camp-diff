import * as vscode from 'vscode';
import { ConflictInfo, FileRange, Member } from '../types';

function getMemberLabel(member: Member): string {
  return member.isLocal ? 'You' : member.username;
}

export class ConnectionStatusItem extends vscode.TreeItem {
  constructor(connected: boolean) {
    super(connected ? '● Connected' : '○ Disconnected', vscode.TreeItemCollapsibleState.None);
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

export class ConflictsSectionItem extends vscode.TreeItem {
  constructor(conflictCount: number) {
    super('CONFLICTS', vscode.TreeItemCollapsibleState.Expanded);
    this.description = String(conflictCount);
    this.contextValue = 'campDiff.conflictsSection';
  }
}

export class ConflictItem extends vscode.TreeItem {
  constructor(readonly conflict: ConflictInfo) {
    const startLine = Math.min(conflict.rangeA.startLine, conflict.rangeB.startLine);
    const endLine = Math.max(conflict.rangeA.endLine, conflict.rangeB.endLine);
    super(`${conflict.filePath} · Lines ${startLine}–${endLine}`, vscode.TreeItemCollapsibleState.None);
    this.description = `${getMemberLabel(conflict.memberA)} ↔ ${getMemberLabel(conflict.memberB)}`;
    this.iconPath = new vscode.ThemeIcon('warning');
    this.contextValue = 'campDiff.conflict';
    this.command = {
      command: 'campDiff.openLocation',
      title: 'Open Location',
      arguments: [conflict.rangeA],
    };
  }
}

export class MemberItem extends vscode.TreeItem {
  constructor(readonly member: Member) {
    super(getMemberLabel(member), vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'campDiff.member';
  }
}

export class MemberFileItem extends vscode.TreeItem {
  constructor(
    readonly member: Member,
    readonly range: FileRange,
    conflicting = false,
  ) {
    super(range.filePath, vscode.TreeItemCollapsibleState.None);
    this.description = `L${range.startLine}-${range.endLine}`;
    if (conflicting) {
      this.iconPath = new vscode.ThemeIcon('warning');
    }
    this.contextValue = 'campDiff.memberFile';
    this.command = {
      command: 'campDiff.openLocation',
      title: 'Open Location',
      arguments: [range],
    };
  }
}
