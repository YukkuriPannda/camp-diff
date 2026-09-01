import { FileRange, PresenceState, RangeRequest, SharedPresenceState } from '../types';

export interface InitializeMessage {
  type: 'initialize';
  roomName: string;
  signalingServerUrls: string[];
  iceServers: RTCIceServer[];
  roomPassword?: string;
  localPresence: PresenceState;
  rangeRequests: RangeRequest[];
}

export interface DisconnectMessage {
  type: 'disconnect';
}

export interface UpdateLocalPresenceMessage {
  type: 'updateLocalPresence';
  localPresence: PresenceState;
}

export interface UpdateRangeRequestsMessage {
  type: 'updateRangeRequests';
  requests: RangeRequest[];
}

export interface PingMessage {
  type: 'ping';
  sentAt: number;
}

export type HostToWebviewMessage =
  | InitializeMessage
  | DisconnectMessage
  | UpdateLocalPresenceMessage
  | UpdateRangeRequestsMessage
  | PingMessage;

export interface ReadyMessage {
  type: 'ready';
}

export interface PongMessage {
  type: 'pong';
  sentAt: number;
}

export interface AwarenessUpdateMessage {
  type: 'awarenessUpdate';
  peers: SharedPresenceState[];
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

function isRangeRequest(value: unknown): value is RangeRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const request = value as Record<string, unknown>;
  return (
    typeof request.peerId === 'string' &&
    request.peerId.length > 0 &&
    typeof request.filePath === 'string' &&
    request.filePath.length > 0
  );
}

export function isSharedPresenceState(value: unknown): value is SharedPresenceState {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const state = value as Record<string, unknown>;
  return (
    typeof state.id === 'string' &&
    state.id.length > 0 &&
    typeof state.username === 'string' &&
    state.username.length > 0 &&
    Array.isArray(state.filePaths) &&
    state.filePaths.every((filePath) => typeof filePath === 'string') &&
    (state.ranges === undefined ||
      (Array.isArray(state.ranges) && state.ranges.every(isFileRange))) &&
    Array.isArray(state.rangeRequests) &&
    state.rangeRequests.every(isRangeRequest) &&
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
  if (message.type === 'updateRangeRequests') {
    return Array.isArray(message.requests) && message.requests.every(isRangeRequest);
  }
  if (message.type === 'disconnect') {
    return true;
  }
  return (
    message.type === 'initialize' &&
    typeof message.roomName === 'string' &&
    Array.isArray(message.signalingServerUrls) &&
    message.signalingServerUrls.every((url) => typeof url === 'string') &&
    Array.isArray(message.iceServers) &&
    isPresenceState(message.localPresence) &&
    Array.isArray(message.rangeRequests) &&
    message.rangeRequests.every(isRangeRequest) &&
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
      return Array.isArray(message.peers) && message.peers.every(isSharedPresenceState);
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
