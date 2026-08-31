import * as vscode from 'vscode';

const SECTION = 'campDiff';
const DEFAULT_SIGNALING_SERVER_URLS = ['ws://localhost:4444'];
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

function isWebSocketUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'ws:' || url.protocol === 'wss:') && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isIceServer(value: unknown): value is RTCIceServer {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const urls = candidate.urls;
  return (
    typeof urls === 'string' ||
    (Array.isArray(urls) && urls.length > 0 && urls.every((url) => typeof url === 'string'))
  );
}

export function getSignalingServerUrls(): string[] {
  const configuredValue = vscode.workspace
    .getConfiguration(SECTION)
    .get<unknown>('signalingServerUrls', DEFAULT_SIGNALING_SERVER_URLS);
  const configured = Array.isArray(configuredValue) ? configuredValue : [];
  const urls = configured.filter((value): value is string => typeof value === 'string' && isWebSocketUrl(value));
  return urls.length > 0 ? urls : DEFAULT_SIGNALING_SERVER_URLS;
}

export function getIceServers(): RTCIceServer[] {
  const configuredValue = vscode.workspace
    .getConfiguration(SECTION)
    .get<unknown>('iceServers', DEFAULT_ICE_SERVERS);
  const configured = Array.isArray(configuredValue) ? configuredValue : [];
  const iceServers = configured.filter(isIceServer);
  return iceServers.length > 0 ? iceServers : DEFAULT_ICE_SERVERS;
}

export function getRoomPassword(): string | undefined {
  const password = vscode.workspace.getConfiguration(SECTION).get<string>('roomPassword', '').trim();
  return password || undefined;
}
