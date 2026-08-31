import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { WebrtcProvider } from 'y-webrtc';
import {
  HostToWebviewMessage,
  isHostToWebviewMessage,
  isPresenceState,
  WebviewToHostMessage,
} from '../bridgeProtocol';
import { PresenceState } from '../../types';

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
let providerStatus: 'connected' | 'disconnected' = 'disconnected';

function postMessage(message: WebviewToHostMessage): void {
  vscode.postMessage(message);
}

function getRemotePeers(): PresenceState[] {
  if (!awareness) {
    return [];
  }
  const peers: PresenceState[] = [];
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID || !state || typeof state !== 'object') {
      continue;
    }
    const presence = (state as Record<string, unknown>).presence;
    if (isPresenceState(presence)) {
      peers.push(presence);
    }
  }
  return peers;
}

function publishRemotePeers(): void {
  const peers = getRemotePeers();
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
  awareness.setLocalState({
    presence: localPresence,
    heartbeatAt: Date.now(),
  });
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
  doc = new Y.Doc();
  awareness = new Awareness(doc);
  awareness.on('change', publishRemotePeers);
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
