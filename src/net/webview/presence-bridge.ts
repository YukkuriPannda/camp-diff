import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { WebrtcProvider } from 'y-webrtc';
import {
  HostToWebviewMessage,
  isHostToWebviewMessage,
  isSharedPresenceState,
  WebviewToHostMessage,
} from '../bridgeProtocol';
import { PresenceState, RangeRequest, SharedPresenceState } from '../../types';

interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const AWARENESS_HEARTBEAT_INTERVAL_MS = 10_000;
const vscode = acquireVsCodeApi();

let doc: Y.Doc | undefined;
let awareness: Awareness | undefined;
let provider: WebrtcProvider | undefined;
let awarenessHeartbeat: ReturnType<typeof setInterval> | undefined;
let localPresence: PresenceState | undefined;
let rangeRequests: RangeRequest[] = [];
let sharedFilePaths = new Set<string>();
let providerStatus: 'connected' | 'disconnected' = 'disconnected';

function postMessage(message: WebviewToHostMessage): void {
  vscode.postMessage(message);
}

function normalizeRangeRequests(requests: RangeRequest[]): RangeRequest[] {
  const unique = new Map<string, RangeRequest>();
  for (const request of requests) {
    unique.set(JSON.stringify([request.peerId, request.filePath]), request);
  }
  return [...unique.values()].sort(
    (left, right) => left.peerId.localeCompare(right.peerId) || left.filePath.localeCompare(right.filePath),
  );
}

function stringSetsEqual(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function getRemotePeers(): SharedPresenceState[] {
  if (!awareness) {
    return [];
  }
  const peers: SharedPresenceState[] = [];
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID || !state || typeof state !== 'object') {
      continue;
    }
    const presence = (state as Record<string, unknown>).presence;
    if (isSharedPresenceState(presence)) {
      peers.push(presence);
    }
  }
  return peers;
}

function publishRemotePeers(peers = getRemotePeers()): void {
  postMessage({ type: 'awarenessUpdate', peers });
  postMessage({
    type: 'providerStatus',
    status: providerStatus,
    peerCount: peers.length,
  });
}

function publishLocalPresence(): void {
  if (!awareness || !localPresence) {
    return;
  }
  const ranges = localPresence.files.filter((range) => sharedFilePaths.has(range.filePath));
  awareness.setLocalState({
    presence: {
      id: localPresence.id,
      username: localPresence.username,
      filePaths: [...new Set(localPresence.files.map((range) => range.filePath))],
      ranges: ranges.length > 0 ? ranges : undefined,
      rangeRequests,
      updatedAt: localPresence.updatedAt,
    } satisfies SharedPresenceState,
    heartbeatAt: Date.now(),
  });
}

function handleAwarenessChange(): void {
  const peers = getRemotePeers();
  const nextSharedFilePaths = new Set<string>();
  if (localPresence) {
    for (const peer of peers) {
      for (const request of peer.rangeRequests) {
        if (request.peerId === localPresence.id) {
          nextSharedFilePaths.add(request.filePath);
        }
      }
    }
  }
  if (!stringSetsEqual(nextSharedFilePaths, sharedFilePaths)) {
    sharedFilePaths = nextSharedFilePaths;
    publishLocalPresence();
    return;
  }
  publishRemotePeers(peers);
}

function destroyProvider(): void {
  if (awarenessHeartbeat) {
    clearInterval(awarenessHeartbeat);
    awarenessHeartbeat = undefined;
  }
  provider?.destroy();
  awareness?.destroy();
  doc?.destroy();
  provider = undefined;
  awareness = undefined;
  doc = undefined;
  sharedFilePaths = new Set<string>();
  providerStatus = 'disconnected';
}

function disconnect(): void {
  destroyProvider();
  postMessage({ type: 'awarenessUpdate', peers: [] });
  postMessage({ type: 'providerStatus', status: 'disconnected', peerCount: 0 });
}

function initialize(message: Extract<HostToWebviewMessage, { type: 'initialize' }>): void {
  destroyProvider();
  localPresence = message.localPresence;
  rangeRequests = normalizeRangeRequests(message.rangeRequests);
  doc = new Y.Doc();
  awareness = new Awareness(doc);
  awareness.on('change', handleAwarenessChange);
  provider = new WebrtcProvider(message.roomName, doc, {
    signaling: message.signalingServerUrls,
    password: message.roomPassword,
    awareness,
    peerOpts: {
      config: {
        iceServers: message.iceServers,
      },
    },
  });
  provider.on('status', (event: { connected: boolean }) => {
    providerStatus = event.connected ? 'connected' : 'disconnected';
    postMessage({
      type: 'providerStatus',
      status: providerStatus,
      peerCount: getRemotePeers().length,
    });
  });
  publishLocalPresence();
  awarenessHeartbeat = setInterval(() => {
    awareness?.setLocalStateField('heartbeatAt', Date.now());
  }, AWARENESS_HEARTBEAT_INTERVAL_MS);
}

function handleMessage(value: unknown): void {
  if (!isHostToWebviewMessage(value)) {
    return;
  }
  switch (value.type) {
    case 'initialize':
      try {
        initialize(value);
      } catch (error) {
        postMessage({ type: 'bridgeError', message: String(error) });
      }
      break;
    case 'updateLocalPresence':
      localPresence = value.localPresence;
      publishLocalPresence();
      break;
    case 'updateRangeRequests':
      rangeRequests = normalizeRangeRequests(value.requests);
      publishLocalPresence();
      break;
    case 'disconnect':
      disconnect();
      break;
    case 'ping':
      postMessage({ type: 'pong', sentAt: value.sentAt });
      break;
  }
}

window.addEventListener('message', (event: MessageEvent<unknown>) => handleMessage(event.data));
window.addEventListener('unload', destroyProvider);
postMessage({ type: 'ready' });
