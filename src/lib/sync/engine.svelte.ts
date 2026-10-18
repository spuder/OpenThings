/**
 * Sync engine: pushes local ops, pulls remote ops, and owns the sync status every shell displays.
 *
 * Triggers: local writes (debounced), a periodic timer, coming back online, the tab becoming visible,
 * and "Sync now". Network calls go through `transport`, so tests and native shells can swap it.
 */
import * as db from '../db';
import { PROTOCOL_VERSION, type HealthResponse, type SyncRequest, type SyncResponse, type SyncState, type SyncStatus } from './protocol';

export interface Transport {
  health(url: string): Promise<HealthResponse>;
  sync(url: string, body: SyncRequest): Promise<SyncResponse>;
}

const TIMEOUT_MS = 10_000;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { 'content-type': 'application/json', ...init?.headers } });
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) {
      // Usually the address serves a web page (e.g. this app's own static container) rather than the API.
      throw new Error(res.ok ? 'No OpenThings sync server at this address (it returned a web page)' : `Server responded ${res.status}`);
    }
    const body = (await res.json().catch(() => {
      throw new Error('The server sent a response that is not valid JSON');
    })) as T & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `Server responded ${res.status}`);
    return body;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Timed out reaching the server');
    if (e instanceof TypeError) throw new Error("Can't reach the server");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const httpTransport: Transport = {
  health: (url) => request<HealthResponse>(`${url}/api/health`),
  sync: (url, body) => request<SyncResponse>(`${url}/api/sync`, { method: 'POST', body: JSON.stringify(body) }),
};

export function normalizeUrl(input: string): string {
  let u = input.trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, '');
}

const INTERVAL_MS = 30_000;
const DEBOUNCE_MS = 1_500;

export class SyncEngine {
  status = $state<SyncStatus>('local');
  enabled = $state(false);
  serverUrl = $state<string | null>(null);
  pending = $state(0);
  lastSyncedAt = $state<string | null>(null);
  error = $state<string | null>(null);
  device = $state('');

  /** Called after remote ops changed local data, so the UI can reload. */
  onRemoteChanges: () => void = () => {};

  private transport: Transport;
  private timer: ReturnType<typeof setInterval> | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private listeners = new Set<(s: SyncState) => void>();

  constructor(transport: Transport = httpTransport) {
    this.transport = transport;
  }

  get state(): SyncState {
    return {
      status: this.status,
      enabled: this.enabled,
      serverUrl: this.serverUrl,
      device: this.device,
      pending: this.pending,
      lastSyncedAt: this.lastSyncedAt,
      error: this.error,
    };
  }

  /** Read config from the local database and start background syncing if enabled. */
  init() {
    this.device = db.deviceId();
    this.serverUrl = db.metaGet('sync.url');
    this.enabled = db.metaGet('sync.enabled') === '1' && !!this.serverUrl;
    this.lastSyncedAt = db.metaGet('sync.last_ok');
    this.pending = db.pendingCount();
    db.onWrite(() => this.localChanged());
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.kick());
      window.addEventListener('offline', () => this.refreshStatus());
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.kick());
    }
    this.refreshStatus();
    if (this.enabled) this.start();
  }

  subscribe(fn: (s: SyncState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const s = this.state;
    for (const fn of this.listeners) fn(s);
  }

  private set(status: SyncStatus, error: string | null = null) {
    this.status = status;
    this.error = error;
    this.emit();
  }

  private refreshStatus() {
    this.pending = db.pendingCount();
    if (!this.enabled) return this.set('local');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return this.set('offline');
    if (this.status === 'syncing' || this.status === 'error') return this.emit();
    this.set(this.pending > 0 ? 'pending' : 'idle');
  }

  private localChanged() {
    this.pending = db.pendingCount();
    if (!this.enabled) return this.emit();
    if (this.status === 'idle') this.set('pending');
    else this.emit();
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.kick(), DEBOUNCE_MS);
  }

  private start() {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.kick(), INTERVAL_MS);
    this.kick();
  }

  private stop() {
    clearInterval(this.timer);
    clearTimeout(this.debounce);
  }

  /** Check a server without saving it. */
  async test(url: string): Promise<HealthResponse> {
    const h = await this.transport.health(normalizeUrl(url));
    if (h.server !== 'openthings') throw new Error('That URL is not an OpenThings server');
    if (h.protocol !== PROTOCOL_VERSION) throw new Error(`Server speaks protocol ${h.protocol}, this app speaks ${PROTOCOL_VERSION}`);
    return h;
  }

  configure(url: string | null, enabled: boolean) {
    const u = url ? normalizeUrl(url) : null;
    if (u !== this.serverUrl) {
      // A different server starts from scratch: pull everything, push everything.
      db.metaSet('sync.cursor', null);
      db.metaSet('sync.pushed_seq', '0');
    }
    this.serverUrl = u;
    this.enabled = enabled && !!u;
    db.metaSet('sync.url', u);
    db.metaSet('sync.enabled', this.enabled ? '1' : '0');
    this.error = null;
    if (this.enabled) {
      this.status = 'pending';
      this.start();
    } else {
      this.stop();
      this.refreshStatus();
    }
    this.emit();
  }

  /** Run one sync now (coalesces with any sync already running). */
  kick(): Promise<void> {
    if (!this.enabled || !this.serverUrl) return Promise.resolve();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.set('offline');
      return Promise.resolve();
    }
    this.running ??= this.run().finally(() => (this.running = null));
    return this.running;
  }

  private async run() {
    const url = this.serverUrl!;
    this.set('syncing');
    try {
      let rounds = 0;
      let more = true;
      while (more && rounds++ < 20) {
        const ops = db.pendingOps();
        const res = await this.transport.sync(url, {
          protocol: PROTOCOL_VERSION,
          device: this.device,
          cursor: db.metaGet('sync.cursor'),
          ops: ops.map(({ seq: _seq, ...o }) => o),
        });
        if (ops.length) db.markPushed(ops.at(-1)!.seq!);
        if (res.ops.length && db.applyRemoteOps(res.ops) > 0) this.onRemoteChanges();
        db.metaSet('sync.cursor', res.cursor);
        more = !!res.more || db.pendingCount() > 0;
      }
      this.lastSyncedAt = new Date().toISOString();
      db.metaSet('sync.last_ok', this.lastSyncedAt);
      this.pending = db.pendingCount();
      this.set(this.pending > 0 ? 'pending' : 'idle');
    } catch (e) {
      this.pending = db.pendingCount();
      this.set('error', (e as Error).message);
    }
  }
}

export const sync = new SyncEngine();
