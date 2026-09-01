import * as vscode from 'vscode';

const SECTION = 'campDiff';
const DEFAULT_SIGNALING_SERVER_URLS = ['ws://localhost:4444'];

function isWebSocketUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'ws:' || url.protocol === 'wss:') && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function getSignalingServerUrls(): string[] {
  const configuredValue = vscode.workspace
    .getConfiguration(SECTION)
    .get<unknown>('signalingServerUrls', DEFAULT_SIGNALING_SERVER_URLS);
  const configured = Array.isArray(configuredValue) ? configuredValue : [];
  const urls = configured.filter((value): value is string => typeof value === 'string' && isWebSocketUrl(value));
  return urls.length > 0 ? urls : DEFAULT_SIGNALING_SERVER_URLS;
}

export function getRoomPassword(): string | undefined {
  const password = vscode.workspace.getConfiguration(SECTION).get<string>('roomPassword', '').trim();
  return password || undefined;
}
