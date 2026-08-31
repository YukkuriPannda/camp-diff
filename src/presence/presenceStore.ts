import * as vscode from 'vscode';
import { FileRange, Member } from '../types';

const LOCAL_MEMBER_ID = 'local';

export class PresenceStore implements vscode.Disposable {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  private username = '';
  private localFiles: FileRange[] = [];
  private updatedAt = 0;

  setUsername(username: string): void {
    if (this.username === username) {
      return;
    }
    this.username = username;
    this.onDidChangeEmitter.fire();
  }

  setLocalFiles(files: FileRange[]): void {
    this.localFiles = files;
    this.updatedAt = Date.now();
    this.onDidChangeEmitter.fire();
  }

  clearLocalFiles(): void {
    if (this.localFiles.length === 0) {
      return;
    }
    this.localFiles = [];
    this.onDidChangeEmitter.fire();
  }

  getYou(): Member {
    return {
      id: LOCAL_MEMBER_ID,
      username: this.username || 'You',
      isLocal: true,
      files: this.localFiles,
      updatedAt: this.updatedAt,
    };
  }

  getMembers(): Member[] {
    return [this.getYou()];
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }
}
