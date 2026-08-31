import { FileRange, PresenceState } from '../types';

export const DEVELOPMENT_ROOM = 'campdiff-dev-room';

export interface InitializeMessage {
  type: 'initialize';
  roomName: string;
  signalingServerUrls: string[];
  iceServers: RTCIceServer[];
  roomPassword?: string;
  localPresence: PresenceState;
}

export interface UpdateLocalPresenceMessage {
  type: 'updateLocalPresence';
  localPresence: PresenceState;
}

export interface PingMessage {
  type: 'ping';
  sentAt: number;
}

export type HostToWebviewMessage = InitializeMessage | UpdateLocalPresenceMessage | PingMessage;

export interface ReadyMessage {
  type: 'ready';
}

export interface PongMessage {
  type: 'pong';
  sentAt: number;
}

export interface AwarenessUpdateMessage {
  type: 'awarenessUpdate';
  peers: PresenceState[];
}

export interface ProviderStatusMessage {
  type: 'providerStatus';
  status: 'connected' | 'disconnected';
  peerCount: number;
}

export interface BridgeErrorMessage {
  type: 'bridgeError';
  message: string;
}

export type WebviewToHostMessage =
  | ReadyMessage
  | PongMessage
  | AwarenessUpdateMessage
  | ProviderStatusMessage
  | BridgeErrorMessage;

function isFileRange(value: unknown): value is FileRange {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const range = value as Record<string, unknown>;
  return (
    typeof range.filePath === 'string' &&
    Number.isInteger(range.startLine) &&
    Number.isInteger(range.endLine) &&
    Number(range.startLine) >= 1 &&
    Number(range.endLine) >= Number(range.startLine)
  );
}

export function isPresenceState(value: unknown): value is PresenceState {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const state = value as Record<string, unknown>;
  return (
    typeof state.id === 'string' &&
    state.id.length > 0 &&
    typeof state.username === 'string' &&
    state.username.length > 0 &&
    Array.isArray(state.files) &&
    state.files.every(isFileRange) &&
    typeof state.updatedAt === 'number' &&
    Number.isFinite(state.updatedAt)
  );
}

export function isHostToWebviewMessage(value: unknown): value is HostToWebviewMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const message = value as Record<string, unknown>;
  if (message.type === 'ping') {
    return typeof message.sentAt === 'number';
  }
  if (message.type === 'updateLocalPresence') {
    return isPresenceState(message.localPresence);
  }
  return (
    message.type === 'initialize' &&
    typeof message.roomName === 'string' &&
    Array.isArray(message.signalingServerUrls) &&
    message.signalingServerUrls.every((url) => typeof url === 'string') &&
    Array.isArray(message.iceServers) &&
    isPresenceState(message.localPresence) &&
    (message.roomPassword === undefined || typeof message.roomPassword === 'string')
  );
}

export function isWebviewToHostMessage(value: unknown): value is WebviewToHostMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case 'ready':
      return true;
    case 'pong':
      return typeof message.sentAt === 'number';
    case 'awarenessUpdate':
      return Array.isArray(message.peers) && message.peers.every(isPresenceState);
    case 'providerStatus':
      return (
        (message.status === 'connected' || message.status === 'disconnected') &&
        typeof message.peerCount === 'number'
      );
    case 'bridgeError':
      return typeof message.message === 'string';
    default:
      return false;
  }
}
