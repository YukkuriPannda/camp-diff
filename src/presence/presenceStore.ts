import * as vscode from 'vscode';
import * as os from 'node:os';
import { FileRange, Member, PresenceState, SharedPresenceState } from '../types';

function rangesEqual(left: FileRange[], right: FileRange[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (range, index) =>
        range.filePath === right[index].filePath &&
        range.startLine === right[index].startLine &&
        range.endLine === right[index].endLine,
    )
  );
}

function stringsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function statesEqual(left: SharedPresenceState[], right: SharedPresenceState[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (state, index) =>
        state.id === right[index].id &&
        state.username === right[index].username &&
        state.updatedAt === right[index].updatedAt &&
        stringsEqual(state.filePaths, right[index].filePaths) &&
        rangesEqual(state.ranges ?? [], right[index].ranges ?? []),
    )
  );
}

export class PresenceStore implements vscode.Disposable {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;
  private readonly onDidChangeLocalEmitter = new vscode.EventEmitter<PresenceState>();
  readonly onDidChangeLocal = this.onDidChangeLocalEmitter.event;

  private username = '';
  private localFiles: FileRange[] = [];
  private updatedAt = 0;
  private remotePresence: SharedPresenceState[] = [];
  private readonly machineId = os.hostname();

  private getLocalId(): string {
    return `${this.username || 'anonymous'}@${this.machineId}:${process.pid}`;
  }

  private publishLocalChange(): void {
    this.onDidChangeLocalEmitter.fire(this.getLocalPresence());
    this.onDidChangeEmitter.fire();
  }

  setUsername(username: string): void {
    if (this.username === username) {
      return;
    }
    this.username = username;
    this.updatedAt = Date.now();
    this.publishLocalChange();
  }

  setLocalFiles(files: FileRange[]): void {
    if (rangesEqual(this.localFiles, files)) {
      return;
    }
    this.localFiles = files;
    this.updatedAt = Date.now();
    this.publishLocalChange();
  }

  setRemotePresence(states: SharedPresenceState[]): void {
    const deduplicated = new Map<string, SharedPresenceState>();
    for (const state of states) {
      if (state.id === this.getLocalId()) {
        continue;
      }
      const current = deduplicated.get(state.id);
      if (!current || current.updatedAt <= state.updatedAt) {
        deduplicated.set(state.id, state);
      }
    }
    const next = [...deduplicated.values()].sort((left, right) => left.id.localeCompare(right.id));
    if (statesEqual(this.remotePresence, next)) {
      return;
    }
    this.remotePresence = next;
    this.onDidChangeEmitter.fire();
  }

  getLocalPresence(): PresenceState {
    return {
      id: this.getLocalId(),
      username: this.username || 'You',
      files: this.localFiles,
      updatedAt: this.updatedAt,
    };
  }

  getYou(): Member {
    const presence = this.getLocalPresence();
    return {
      ...presence,
      isLocal: true,
      filePaths: [...new Set(presence.files.map((range) => range.filePath))],
      detailedFilePaths: [...new Set(presence.files.map((range) => range.filePath))],
    };
  }

  getMembers(): Member[] {
    return [
      this.getYou(),
      ...this.remotePresence.map((presence) => ({
        id: presence.id,
        username: presence.username,
        filePaths: presence.filePaths,
        files: presence.ranges ?? [],
        detailedFilePaths: [...new Set((presence.ranges ?? []).map((range) => range.filePath))],
        updatedAt: presence.updatedAt,
        isLocal: false,
      })),
    ];
  }

  dispose(): void {
    this.onDidChangeLocalEmitter.dispose();
    this.onDidChangeEmitter.dispose();
  }
}
