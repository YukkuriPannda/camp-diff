import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { PresenceState } from '../types';
import {
  DEVELOPMENT_ROOM,
  HostToWebviewMessage,
  isWebviewToHostMessage,
  WebviewToHostMessage,
} from './bridgeProtocol';
import { getIceServers, getRoomPassword, getSignalingServerUrls } from './signalingConfig';

const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 15_000;
const INITIAL_RECREATE_DELAY_MS = 1_000;
const MAX_RECREATE_DELAY_MS = 30_000;

export class WebviewBridge implements vscode.Disposable {
  private readonly onDidChangeConnectionEmitter = new vscode.EventEmitter<boolean>();
  readonly onDidChangeConnection = this.onDidChangeConnectionEmitter.event;

  private panel: vscode.WebviewPanel | undefined;
  private messageListener: vscode.Disposable | undefined;
  private heartbeatInterval: ReturnType<typeof setInterval> | undefined;
  private heartbeatTimeout: ReturnType<typeof setTimeout> | undefined;
  private recreateTimer: ReturnType<typeof setTimeout> | undefined;
  private recreateDelayMs = INITIAL_RECREATE_DELAY_MS;
  private connected = false;
  private disposed = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private localPresence: PresenceState,
    private readonly onRemotePresence: (peers: PresenceState[]) => void,
    private readonly outputChannel: vscode.OutputChannel,
  ) {
    this.createPanel();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  updateLocalPresence(localPresence: PresenceState): void {
    this.localPresence = localPresence;
    this.postMessage({ type: 'updateLocalPresence', localPresence });
  }

  private createPanel(): void {
    if (this.disposed) {
      return;
    }
    try {
      const scriptRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
      const panel = vscode.window.createWebviewPanel(
        'campDiff.backgroundSync',
        'camp-diff (background sync)',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [scriptRoot],
        },
      );
      this.panel = panel;
      this.messageListener = panel.webview.onDidReceiveMessage((message: unknown) => this.handleMessage(message));
      panel.onDidDispose(() => this.handlePanelDisposed());
      panel.webview.html = this.createHtml(panel.webview);
      this.startHeartbeat();
    } catch (error) {
      this.outputChannel.appendLine(`background sync panel creation failed: ${String(error)}`);
      const failedPanel = this.panel;
      this.panel = undefined;
      failedPanel?.dispose();
      this.scheduleRecreation();
    }
  }

  private createHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'presence-bridge.js'),
    );
    const signalingServerUrls = getSignalingServerUrls();
    const connectSources = signalingServerUrls.map((url) => new URL(url).origin).join(' ');
    const templatePath = vscode.Uri.joinPath(
      this.context.extensionUri,
      'dist',
      'webview',
      'presence-bridge.html',
    ).fsPath;
    return fs
      .readFileSync(templatePath, 'utf8')
      .replaceAll('{{cspSource}}', webview.cspSource)
      .replaceAll('{{connectSources}}', connectSources)
      .replaceAll('{{nonce}}', nonce)
      .replaceAll('{{scriptUri}}', scriptUri.toString());
  }

  private handleMessage(value: unknown): void {
    if (!isWebviewToHostMessage(value)) {
      this.outputChannel.appendLine('background sync bridge ignored an invalid message');
      return;
    }
    const message: WebviewToHostMessage = value;
    switch (message.type) {
      case 'ready':
        this.postMessage({
          type: 'initialize',
          roomName: DEVELOPMENT_ROOM,
          signalingServerUrls: getSignalingServerUrls(),
          iceServers: getIceServers(),
          roomPassword: getRoomPassword(),
          localPresence: this.localPresence,
        });
        this.sendPing();
        break;
      case 'pong':
        this.markAlive();
        break;
      case 'awarenessUpdate':
        this.onRemotePresence(message.peers);
        break;
      case 'providerStatus':
        this.outputChannel.appendLine(
          `background sync provider ${message.status}; awareness peers: ${message.peerCount}`,
        );
        break;
      case 'bridgeError':
        this.outputChannel.appendLine(`background sync bridge error: ${message.message}`);
        break;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.sendPing();
    this.heartbeatInterval = setInterval(() => this.sendPing(), HEARTBEAT_INTERVAL_MS);
  }

  private sendPing(): void {
    const sentAt = Date.now();
    this.postMessage({ type: 'ping', sentAt });
    if (!this.heartbeatTimeout) {
      this.heartbeatTimeout = setTimeout(() => {
        this.heartbeatTimeout = undefined;
        this.setConnected(false);
      }, HEARTBEAT_TIMEOUT_MS);
    }
  }

  private markAlive(): void {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
    }
    this.heartbeatTimeout = setTimeout(() => {
      this.heartbeatTimeout = undefined;
      this.setConnected(false);
    }, HEARTBEAT_TIMEOUT_MS);
    this.recreateDelayMs = INITIAL_RECREATE_DELAY_MS;
    this.setConnected(true);
  }

  private postMessage(message: HostToWebviewMessage): void {
    if (!this.panel) {
      return;
    }
    void this.panel.webview.postMessage(message).then(
      (delivered) => {
        if (!delivered) {
          this.setConnected(false);
        }
      },
      () => this.setConnected(false),
    );
  }

  private setConnected(connected: boolean): void {
    if (this.connected === connected) {
      return;
    }
    this.connected = connected;
    this.onDidChangeConnectionEmitter.fire(connected);
  }

  private handlePanelDisposed(): void {
    this.panel = undefined;
    this.messageListener?.dispose();
    this.messageListener = undefined;
    this.stopHeartbeat();
    this.setConnected(false);
    this.onRemotePresence([]);
    this.scheduleRecreation();
  }

  private scheduleRecreation(): void {
    if (this.disposed || this.recreateTimer) {
      return;
    }
    const delay = this.recreateDelayMs;
    this.recreateDelayMs = Math.min(this.recreateDelayMs * 2, MAX_RECREATE_DELAY_MS);
    this.outputChannel.appendLine(`background sync panel will restart in ${delay}ms`);
    this.recreateTimer = setTimeout(() => {
      this.recreateTimer = undefined;
      this.createPanel();
    }, delay);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = undefined;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopHeartbeat();
    if (this.recreateTimer) {
      clearTimeout(this.recreateTimer);
      this.recreateTimer = undefined;
    }
    this.messageListener?.dispose();
    this.messageListener = undefined;
    this.panel?.dispose();
    this.panel = undefined;
    this.setConnected(false);
    this.onDidChangeConnectionEmitter.dispose();
  }
}
