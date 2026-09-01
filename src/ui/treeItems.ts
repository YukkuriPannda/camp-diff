import * as vscode from 'vscode';
import { ConflictInfo, FileRange, Member } from '../types';
import { GitWorkspaceState } from '../git/gitService';
import { getRepositoryDisplayName, resolveBranchIdentifier } from '../git/roomKey';

function getMemberLabel(member: Member): string {
  return member.isLocal ? 'You' : member.username;
}

export class ConnectionStatusItem extends vscode.TreeItem {
  constructor(connected: boolean) {
    super(connected ? '● Connected' : '○ Disconnected', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'campDiff.connectionStatus';
  }
}

export class RepositoryStatusItem extends vscode.TreeItem {
  constructor(state: GitWorkspaceState) {
    super(RepositoryStatusItem.getLabel(state), vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'campDiff.repositoryStatus';
    this.tooltip = RepositoryStatusItem.getTooltip(state);
  }

  private static getLabel(state: GitWorkspaceState): string {
    switch (state.kind) {
      case 'extensionMissing':
        return 'Git unavailable · vscode.git not found';
      case 'extensionDisabled':
        return 'Git unavailable · vscode.git disabled';
      case 'noRepository':
        return `${state.workspaceName ?? 'Workspace'} · No Git repository`;
      case 'repository': {
        const repository =
          getRepositoryDisplayName(state.remoteUrl) ?? state.workspaceName ?? state.rootUri.path.split('/').at(-1) ?? 'Repository';
        if (!state.remoteUrl) {
          return `${repository} · No ${state.remoteName} remote`;
        }
        if (state.branchName) {
          return `${repository} · ${state.branchName}`;
        }
        const commit = resolveBranchIdentifier(undefined, state.commitHash);
        return commit ? `${repository} · ${commit} (detached)` : `${repository} · No HEAD`;
      }
    }
  }

  private static getTooltip(state: GitWorkspaceState): string {
    switch (state.kind) {
      case 'extensionMissing':
        return '組み込みのvscode.git拡張が見つからないため、camp-diffは接続しません。';
      case 'extensionDisabled':
        return 'vscode.git拡張が無効なため、camp-diffは接続しません。';
      case 'noRepository':
        return '現在のワークスペースにGitリポジトリが見つからないため、camp-diffは接続しません。';
      case 'repository':
        return state.remoteUrl
          ? `Room remote: ${state.remoteName}`
          : `Git remote "${state.remoteName}"が見つからないため、camp-diffは接続しません。`;
    }
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
    this.id = `campDiff.member.${member.id}`;
    this.contextValue = 'campDiff.member';
  }
}

export class MemberFileItem extends vscode.TreeItem {
  constructor(
    readonly member: Member,
    readonly filePath: string,
    conflicting = false,
  ) {
    super(filePath, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `campDiff.memberFile.${member.id}.${filePath}`;
    if (conflicting) {
      this.iconPath = new vscode.ThemeIcon('warning');
    }
    this.contextValue = 'campDiff.memberFile';
  }
}

export class MemberRangeItem extends vscode.TreeItem {
  constructor(readonly range: FileRange, conflicting = false) {
    super(`Lines ${range.startLine}–${range.endLine}`, vscode.TreeItemCollapsibleState.None);
    if (conflicting) {
      this.iconPath = new vscode.ThemeIcon('warning');
    }
    this.contextValue = 'campDiff.memberRange';
    this.command = {
      command: 'campDiff.openLocation',
      title: 'Open Location',
      arguments: [range],
    };
  }
}

export class MemberLoadingItem extends vscode.TreeItem {
  constructor() {
    super('Loading lines…', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('loading~spin');
    this.contextValue = 'campDiff.memberLoading';
  }
}
