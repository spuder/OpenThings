/**
 * Sync protocol, version 0 (draft). Shared by the web client and the server (server/).
 * See docs/sync.md.
 *
 *   GET  {server}/api/health  -> HealthResponse
 *   POST {server}/api/sync    SyncRequest -> SyncResponse
 *
 * Auth: none in v0; the server is only reachable on the tailnet (DockTail).
 */
import type { Op } from '../schema';

export const PROTOCOL_VERSION = 0;

export interface HealthResponse {
  ok: boolean;
  server: 'openthings';
  protocol: number;
  version?: string;
}

export interface SyncRequest {
  protocol: number;
  device: string;
  /** Opaque server cursor from the last successful sync; null on first sync. */
  cursor: string | null;
  /** Local ops not yet acknowledged by the server, oldest first. */
  ops: Op[];
}

export interface SyncResponse {
  /** Number of pushed ops the server stored (it dedupes on hlc + device). */
  accepted: number;
  /** Ops from other devices since `cursor`, oldest first. */
  ops: Op[];
  cursor: string;
  /** True when more remote ops are waiting; the client syncs again immediately. */
  more?: boolean;
}

/** What every shell (web, Tauri, Capacitor) shows to the user. */
export type SyncStatus =
  | 'local' // sync not configured: data stays on this device
  | 'idle' // configured and up to date
  | 'pending' // local changes waiting to be pushed
  | 'syncing' // request in flight
  | 'offline' // browser/device reports no network
  | 'error'; // server unreachable or rejected the request

export interface SyncState {
  status: SyncStatus;
  enabled: boolean;
  serverUrl: string | null;
  device: string;
  /** Local ops not yet pushed. */
  pending: number;
  /** ISO time of the last successful sync. */
  lastSyncedAt: string | null;
  /** Human-readable reason when status is 'error'. */
  error: string | null;
}
