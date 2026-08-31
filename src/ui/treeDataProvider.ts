import * as vscode from 'vscode';
import { ConflictInfo, FileRange, Member } from '../types';
import { detectConflicts } from '../conflict/conflictDetector';
import * as config from '../config';
import { PresenceStore } from '../presence/presenceStore';
import {
  ConflictItem,
  ConflictsSectionItem,
  ConnectionStatusItem,
  MembersSectionItem,
  MemberItem,
  MemberFileItem,
  RepositoryStatusItem,
} from './treeItems';
import { GitWorkspaceState } from '../git/gitService';

type CampDiffTreeElement =
  | { type: 'connectionStatus' }
  | { type: 'repositoryStatus' }
  | { type: 'conflictsSection' }
  | { type: 'conflict'; conflict: ConflictInfo }
  | { type: 'membersSection' }
  | { type: 'member'; member: Member }
  | { type: 'memberFile'; member: Member; range: FileRange };

export class CampDiffTreeProvider implements vscode.TreeDataProvider<CampDiffTreeElement>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];
  private connected = false;
  private conflicts: ConflictInfo[] = [];

  constructor(
    private readonly presenceStore: PresenceStore,
    private gitState: GitWorkspaceState,
  ) {
    this.recalculateConflicts();
    this.disposables.push(
      presenceStore.onDidChange(() => {
        this.recalculateConflicts();
        this.onDidChangeTreeDataEmitter.fire();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('campDiff.conflictProximityLines')) {
          this.recalculateConflicts();
          this.onDidChangeTreeDataEmitter.fire();
        }
      }),
    );
  }

  private recalculateConflicts(): void {
    this.conflicts = detectConflicts(this.presenceStore.getMembers(), config.getConflictProximityLines());
  }

  private isConflicting(member: Member, range: FileRange): boolean {
    return this.conflicts.some(
      (conflict) =>
        this.matchesConflictSide(member, range, conflict.memberA, conflict.rangeA) ||
        this.matchesConflictSide(member, range, conflict.memberB, conflict.rangeB),
    );
  }

  private matchesConflictSide(
    member: Member,
    range: FileRange,
    conflictMember: Member,
    conflictRange: FileRange,
  ): boolean {
    return (
      member.id === conflictMember.id &&
      range.filePath === conflictRange.filePath &&
      range.startLine === conflictRange.startLine &&
      range.endLine === conflictRange.endLine
    );
  }

  getConflicts(): ConflictInfo[] {
    return [...this.conflicts];
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
      case 'conflictsSection':
        return new ConflictsSectionItem(this.conflicts.length);
      case 'conflict':
        return new ConflictItem(element.conflict);
      case 'membersSection':
        return new MembersSectionItem(this.presenceStore.getMembers().length);
      case 'member':
        return new MemberItem(element.member);
      case 'memberFile':
        return new MemberFileItem(element.member, element.range, this.isConflicting(element.member, element.range));
    }
  }

  getChildren(element?: CampDiffTreeElement): CampDiffTreeElement[] {
    if (!element) {
      const root: CampDiffTreeElement[] = [{ type: 'connectionStatus' }, { type: 'repositoryStatus' }];
      if (this.conflicts.length > 0) {
        root.push({ type: 'conflictsSection' });
      }
      root.push({ type: 'membersSection' });
      return root;
    }
    if (element.type === 'conflictsSection') {
      return this.conflicts.map((conflict) => ({ type: 'conflict', conflict }));
    }
    if (element.type === 'membersSection') {
      return this.presenceStore.getMembers().map((member) => ({ type: 'member', member }));
    }
    if (element.type === 'member') {
      return element.member.files.map((range) => ({ type: 'memberFile', member: element.member, range }));
    }
    return [];
  }

  dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.onDidChangeTreeDataEmitter.dispose();
  }
}
