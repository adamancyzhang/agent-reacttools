import WebSocket from 'ws';
import { ArtError } from '../errors.js';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Minimal CDP client over a WebSocket. Correlates responses by an
 * incrementing id, supports sessionId (flattened target sessions), and
 * routes non-id messages to event handlers.
 */
export class CdpClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private eventHandlers: Array<(msg: Record<string, unknown>) => void> = [];
  private closed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data) => this.handleMessage(data.toString()));
    ws.on('error', () => this.failAll(new ArtError('browser-closed', 'Browser connection lost.')));
    ws.on('close', () => this.failAll(new ArtError('browser-closed', 'Browser connection closed.')));
  }

  static async connect(wsUrl: string, opts: { timeoutMs?: number } = {}): Promise<CdpClient> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new ArtError('connect-timeout', `Timed out connecting to ${wsUrl}.`));
      }, timeoutMs);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', (err) => {
        clearTimeout(timer);
        reject(
          new ArtError('connect-failed', `Cannot connect to CDP endpoint ${wsUrl}: ${err.message}`),
        );
      });
    });
    return new CdpClient(ws);
  }

  /** Send a CDP command; resolves with the response's `result` field. */
  send(
    method: string,
    params: object = {},
    opts: { sessionId?: string | null; timeoutMs?: number } = {},
  ): Promise<unknown> {
    if (this.closed) return Promise.reject(new ArtError('browser-closed', 'Browser connection closed.'));
    const id = this.nextId++;
    const msg: Record<string, unknown> = { id, method, params };
    if (opts.sessionId) msg.sessionId = opts.sessionId;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ArtError('cdp-timeout', `CDP command ${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(msg), (err) => {
        if (err) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(new ArtError('send-failed', `Failed to send CDP command: ${err.message}`));
        }
      });
    });
  }

  onEvent(handler: (msg: Record<string, unknown>) => void): void {
    this.eventHandlers.push(handler);
  }

  close(): void {
    this.closed = true;
    this.failAll(new ArtError('browser-closed', 'Browser connection closed.'));
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }

  private handleMessage(data: string): void {
    let msg: { id?: number; method?: string; error?: { message: string }; result?: unknown };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.id != null) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new ArtError('cdp-error', msg.error.message));
      else p.resolve(msg.result);
    } else if (msg.method) {
      for (const h of this.eventHandlers) h(msg);
    }
  }

  private failAll(err: Error): void {
    if (this.pending.size === 0) return;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}
