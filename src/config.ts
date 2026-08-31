import * as vscode from 'vscode';

const SECTION = 'campDiff';

export function getUsername(): string {
  return vscode.workspace.getConfiguration(SECTION).get<string>('username', '').trim();
}

export function setUsername(username: string): Thenable<void> {
  return vscode.workspace.getConfiguration(SECTION).update('username', username, vscode.ConfigurationTarget.Global);
}

export function getCursorContextLines(): number {
  return vscode.workspace.getConfiguration(SECTION).get<number>('cursorContextLines', 3);
}

export function getIdleTimeoutSeconds(): number {
  return vscode.workspace.getConfiguration(SECTION).get<number>('idleTimeoutSeconds', 120);
}

export function getConflictProximityLines(): number {
  return vscode.workspace.getConfiguration(SECTION).get<number>('conflictProximityLines', 3);
}

export function getRemoteName(): string {
  return vscode.workspace.getConfiguration(SECTION).get<string>('remoteName', 'origin').trim() || 'origin';
}
