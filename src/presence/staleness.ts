import * as vscode from 'vscode';
import * as config from '../config';

const CHECK_INTERVAL_MS = 5000;

export class LocalStaleness implements vscode.Disposable {
  private lastActivityAt = Date.now();
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly onIdle: () => void) {
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
  }

  touch(): void {
    this.lastActivityAt = Date.now();
  }

  private check(): void {
    const timeoutMs = config.getIdleTimeoutSeconds() * 1000;
    if (Date.now() - this.lastActivityAt >= timeoutMs) {
      this.onIdle();
    }
  }

  dispose(): void {
    clearInterval(this.timer);
  }
}
