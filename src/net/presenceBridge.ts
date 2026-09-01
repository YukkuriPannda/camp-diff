import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import WebSocket from 'ws';
import { PresenceState, RangeRequest, SharedPresenceState } from '../types';
import { getRoomPassword, getSignalingServerUrls } from './signalingConfig';
import { createRelayPresenceMessage, decodeRelayPresenceMessage } from './relayProtocol';

const HEARTBEAT_INTERVAL_MS = 10_000;
const STALE_PEER_TIMEOUT_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

interface RelayConnection {
  socket?: WebSocket;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  reconnectDelayMs: number;
}

interface RemotePeer {
  state: SharedPresenceState;
  lastSeen: number;
}

function rangeRequestKey(peerId: string, filePath: string): string {
  return JSON.stringify([peerId, filePath]);
}

function stringSetsEqual(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

export class PresenceBridge implements vscode.Disposable {
  private readonly onDidChangeConnectionEmitter = new vscode.EventEmitter<boolean>();
  readonly onDidChangeConnection = this.onDidChangeConnectionEmitter.event;

  private readonly senderId = crypto.randomUUID();
  private readonly rangeRequests = new Map<string, RangeRequest>();
  private readonly connections = new Map<string, RelayConnection>();
  private readonly remotePeers = new Map<string, RemotePeer>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private sharedFilePaths = new Set<string>();
  private connected = false;
  private disposed = false;

  constructor(
    private roomKey: string | undefined,
    private localPresence: PresenceState,
    private readonly onRemotePresence: (peers: SharedPresenceState[]) => void,
    private readonly outputChannel: vscode.OutputChannel,
  ) {
    this.restartConnections();
    this.heartbeat = setInterval(() => this.handleHeartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  updateLocalPresence(localPresence: PresenceState): void {
    this.localPresence = localPresence;
    this.publishLocalPresence();
  }

  setRangeRequested(peerId: string, filePath: string, requested: boolean): void {
    const key = rangeRequestKey(peerId, filePath);
    if (requested) {
      if (this.rangeRequests.has(key)) {
        return;
      }
      this.rangeRequests.set(key, { peerId, filePath });
    } else if (!this.rangeRequests.delete(key)) {
      return;
    }
    this.publishLocalPresence();
    this.publishRemotePresence();
  }

  updateRoomKey(roomKey: string | undefined): void {
    if (this.roomKey === roomKey) {
      return;
    }
    this.publishLeave();
    this.roomKey = roomKey;
    this.rangeRequests.clear();
    this.remotePeers.clear();
    this.sharedFilePaths = new Set<string>();
    this.onRemotePresence([]);
    this.restartConnections();
  }

  refreshConnectionSettings(): void {
    this.remotePeers.clear();
    this.sharedFilePaths = new Set<string>();
    this.onRemotePresence([]);
    this.restartConnections();
  }

  private restartConnections(): void {
    this.closeConnections();
    if (!this.roomKey || this.disposed) {
      this.setConnected(false);
      return;
    }
    for (const url of new Set(getSignalingServerUrls())) {
      this.connections.set(url, { reconnectDelayMs: INITIAL_RECONNECT_DELAY_MS });
      this.connect(url);
    }
  }

  private connect(url: string): void {
    const connection = this.connections.get(url);
    if (!connection || this.disposed || !this.roomKey) {
      return;
    }
    try {
      const socket = new WebSocket(url);
      connection.socket = socket;
      socket.on('open', () => {
        if (connection.socket !== socket || !this.roomKey) {
          socket.close();
          return;
        }
        connection.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
        socket.send(JSON.stringify({ type: 'subscribe', topics: [this.roomKey] }));
        this.updateConnectionState();
        this.publishLocalPresence();
      });
      socket.on('message', (data) => this.handleMessage(data.toString()));
      socket.on('error', (error) => {
        this.outputChannel.appendLine(`background sync relay ${url} error: ${String(error)}`);
      });
      socket.on('close', () => {
        if (connection.socket !== socket) {
          return;
        }
        connection.socket = undefined;
        this.updateConnectionState();
        this.scheduleReconnect(url, connection);
      });
    } catch (error) {
      this.outputChannel.appendLine(`background sync relay ${url} start failed: ${String(error)}`);
      this.scheduleReconnect(url, connection);
    }
  }

  private scheduleReconnect(url: string, connection: RelayConnection): void {
    if (this.disposed || connection.reconnectTimer || !this.connections.has(url)) {
      return;
    }
    const delay = connection.reconnectDelayMs;
    connection.reconnectDelayMs = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
    connection.reconnectTimer = setTimeout(() => {
      connection.reconnectTimer = undefined;
      this.connect(url);
    }, delay);
  }

  private handleMessage(raw: string): void {
    if (!this.roomKey) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return;
    }
    const decoded = decodeRelayPresenceMessage(parsed, this.roomKey, getRoomPassword());
    if (!decoded || decoded.senderId === this.senderId) {
      return;
    }
    if (decoded.state === null) {
      this.remotePeers.delete(decoded.senderId);
    } else {
      this.remotePeers.set(decoded.senderId, { state: decoded.state, lastSeen: Date.now() });
    }
    this.recomputePresence();
  }

  private recomputePresence(): void {
    const peers = [...this.remotePeers.values()].map(({ state }) => state);
    const nextSharedFilePaths = new Set<string>();
    for (const peer of peers) {
      for (const request of peer.rangeRequests) {
        if (request.peerId === this.localPresence.id) {
          nextSharedFilePaths.add(request.filePath);
        }
      }
    }
    const sharingChanged = !stringSetsEqual(nextSharedFilePaths, this.sharedFilePaths);
    this.sharedFilePaths = nextSharedFilePaths;
    const requestsChanged = this.pruneRangeRequests(peers);
    if (sharingChanged || requestsChanged) {
      this.publishLocalPresence();
    }
    this.publishRemotePresence();
  }

  private getSharedLocalPresence(): SharedPresenceState {
    const ranges = this.localPresence.files.filter((range) =>
      this.sharedFilePaths.has(range.filePath),
    );
    return {
      id: this.localPresence.id,
      username: this.localPresence.username,
      filePaths: [...new Set(this.localPresence.files.map((range) => range.filePath))],
      ranges: ranges.length > 0 ? ranges : undefined,
      rangeRequests: this.getRangeRequests(),
      updatedAt: this.localPresence.updatedAt,
    };
  }

  private publishLocalPresence(): void {
    if (!this.roomKey) {
      return;
    }
    this.broadcast(
      createRelayPresenceMessage(
        this.roomKey,
        this.senderId,
        this.getSharedLocalPresence(),
        getRoomPassword(),
      ),
    );
  }

  private publishLeave(): void {
    if (!this.roomKey) {
      return;
    }
    this.broadcast(
      createRelayPresenceMessage(this.roomKey, this.senderId, null, getRoomPassword()),
    );
  }

  private broadcast(message: unknown): void {
    const serialized = JSON.stringify(message);
    for (const { socket } of this.connections.values()) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(serialized);
      }
    }
  }

  private publishRemotePresence(): void {
    this.onRemotePresence(
      [...this.remotePeers.values()].map(({ state: peer }) => {
        const requestedFiles = new Set(
          this.getRangeRequests()
            .filter((request) => request.peerId === peer.id)
            .map((request) => request.filePath),
        );
        return {
          ...peer,
          ranges:
            requestedFiles.size > 0
              ? peer.ranges?.filter((range) => requestedFiles.has(range.filePath))
              : undefined,
        };
      }),
    );
  }

  private getRangeRequests(): RangeRequest[] {
    return [...this.rangeRequests.values()].sort(
      (left, right) =>
        left.peerId.localeCompare(right.peerId) || left.filePath.localeCompare(right.filePath),
    );
  }

  private pruneRangeRequests(peers: SharedPresenceState[]): boolean {
    const liveFilesByPeer = new Map(peers.map((peer) => [peer.id, new Set(peer.filePaths)]));
    let changed = false;
    for (const [key, request] of this.rangeRequests) {
      if (!liveFilesByPeer.get(request.peerId)?.has(request.filePath)) {
        this.rangeRequests.delete(key);
        changed = true;
      }
    }
    return changed;
  }

  private handleHeartbeat(): void {
    const cutoff = Date.now() - STALE_PEER_TIMEOUT_MS;
    let removed = false;
    for (const [senderId, peer] of this.remotePeers) {
      if (peer.lastSeen < cutoff) {
        this.remotePeers.delete(senderId);
        removed = true;
      }
    }
    if (removed) {
      this.recomputePresence();
    }
    this.publishLocalPresence();
  }

  private updateConnectionState(): void {
    const connected = [...this.connections.values()].some(
      ({ socket }) => socket?.readyState === WebSocket.OPEN,
    );
    this.setConnected(connected);
    this.outputChannel.appendLine(`background sync relay ${connected ? 'connected' : 'disconnected'}`);
  }

  private setConnected(connected: boolean): void {
    if (this.connected === connected) {
      return;
    }
    this.connected = connected;
    this.onDidChangeConnectionEmitter.fire(connected);
  }

  private closeConnections(): void {
    for (const connection of this.connections.values()) {
      if (connection.reconnectTimer) {
        clearTimeout(connection.reconnectTimer);
      }
      connection.socket?.removeAllListeners();
      connection.socket?.close();
    }
    this.connections.clear();
    this.setConnected(false);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.publishLeave();
    this.disposed = true;
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
    this.closeConnections();
    this.remotePeers.clear();
    this.onRemotePresence([]);
    this.onDidChangeConnectionEmitter.dispose();
  }
}
