/**
 * Pure helpers for the native (Capacitor) shells. No Capacitor imports here, so this file is unit tested
 * and safe to import from anywhere.
 *
 * The iOS app writes `buildSnapshot()` as JSON into the shared App Group container; widgets read it.
 * Extensions (Share Sheet, Shortcuts) can't run this web code, so they append `PendingItem`s to a
 * file in the same container and the app imports them through `store.addParsed` (see docs/ios.md).
 */
import type { Parsed } from '../parse';
import { parseQuickAdd } from '../parse';
import type { UpcomingReminder } from '../reminders.svelte';
import { parsePairCode } from '../sync/pair';
import type { SyncState } from '../sync/protocol';
import type { Area, Project, Task } from '../types';
import * as V from '../views';

export const SNAPSHOT_VERSION = 1;
/** Widgets show at most this many to-dos; the rest are a count. */
const MAX_TODAY = 12;
/** iOS keeps at most 64 pending local notifications per app; leave room for others. */
export const MAX_SCHEDULED = 60;

export interface SnapshotTask {
  id: string;
  title: string;
  evening: boolean;
  /** Project or area name, if any. */
  container: string | null;
  deadline: string | null;
  reminderAt: string | null;
}

export interface Snapshot {
  version: number;
  generatedAt: string;
  /** Local day (YYYY-MM-DD) the lists were computed for. Widgets show a hint when it's stale. */
  day: string;
  today: SnapshotTask[];
  counts: { today: number; evening: number; inbox: number; dump: number };
  reminders: UpcomingReminder[];
  sync: Pick<SyncState, 'status' | 'enabled' | 'pending' | 'lastSyncedAt' | 'error'>;
}

export function buildSnapshot(input: {
  tasks: Task[];
  projects: Project[];
  areas: Area[];
  day: string;
  now: number;
  reminders: UpcomingReminder[];
  sync: SyncState;
}): Snapshot {
  const { tasks, projects, areas, day, now, reminders, sync } = input;
  const none = new Set<string>();
  const t = V.todayView(tasks, day, none);
  const names = new Map<string, string>();
  for (const p of projects) names.set(p.id, p.name);
  for (const a of areas) names.set(a.id, a.name);
  const row = (x: Task): SnapshotTask => ({
    id: x.id,
    title: x.title,
    evening: !!x.evening,
    container: (x.project_id && names.get(x.project_id)) || (x.area_id && names.get(x.area_id)) || null,
    deadline: x.deadline,
    reminderAt: x.reminder_at && !x.reminder_sent_at ? x.reminder_at : null,
  });
  return {
    version: SNAPSHOT_VERSION,
    generatedAt: new Date(now).toISOString(),
    day,
    today: [...t.day, ...t.evening].slice(0, MAX_TODAY).map(row),
    counts: {
      today: t.day.length,
      evening: t.evening.length,
      inbox: V.inbox(tasks, none).length,
      dump: V.dump(tasks, none, now).length,
    },
    reminders: reminders.slice(0, 20),
    sync: {
      status: sync.status,
      enabled: sync.enabled,
      pending: sync.pending,
      lastSyncedAt: sync.lastSyncedAt,
      error: sync.error,
    },
  };
}

/**
 * Local notification ids must be 32-bit integers on iOS/Android. Derive a stable positive id from the
 * task id (FNV-1a), so rescheduling the same reminder replaces it instead of duplicating it.
 */
export function notificationId(taskId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < taskId.length; i++) {
    h ^= taskId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Positive, non-zero, fits in a Java int as well.
  return (h >>> 1) || 1;
}

/** An item written by the Share extension or a Shortcut, waiting in the App Group for the app to import. */
export interface PendingItem {
  id: string;
  /** Quick-add text (when `parse`) or a plain title. */
  text: string;
  notes?: string;
  /** true: use quick-add syntax (Shortcuts). false: take the text literally (shared web pages). */
  parse: boolean;
  target: 'inbox' | 'dump';
  source: string;
  createdAt: string;
}

/** Turn a pending item into what `store.addParsed(…, { useContext: false })` expects. */
export function pendingToParsed(item: PendingItem, day: string, now = new Date()): Parsed | null {
  const text = (item.text ?? '').trim();
  const notes = (item.notes ?? '').trim();
  let p: Parsed;
  if (item.parse) {
    p = parseQuickAdd(text, day, now);
    if (notes) p.notes = p.notes ? `${p.notes}\n${notes}` : notes;
  } else {
    // Shared text can contain '#', '@' or '//' (URLs), so it is not run through the quick-add parser.
    const [first, ...rest] = text.split(/\r?\n/);
    p = parseQuickAdd('', day, now);
    p.title = first.trim().slice(0, 500);
    p.notes = [rest.join('\n').trim(), notes].filter(Boolean).join('\n');
    if (!p.title && notes) {
      p.title = notes.split(/\r?\n/)[0].slice(0, 500);
      p.notes = notes;
    }
  }
  if (!p.title) return null;
  if (item.target === 'dump' && !p.dump && !p.when && !p.project) p.dump = true;
  return p;
}

/** Routes from widgets, notifications, Shortcuts and pairing QR codes: `openthings://today`, `openthings://task/<id>`, `openthings://pair?server=…`, … */
export type Route =
  | { kind: 'view'; view: 'inbox' | 'today' | 'upcoming' | 'dump' }
  | { kind: 'task'; id: string }
  | { kind: 'add'; text: string }
  | { kind: 'pair'; server: string };

export function parseRoute(url: string): Route | null {
  const m = /^openthings:\/\/([^/?#]*)\/?([^?#]*)(?:\?([^#]*))?/i.exec(url.trim());
  if (!m) return null;
  const host = m[1].toLowerCase();
  const rest = decodeURIComponent(m[2] ?? '');
  const query = new URLSearchParams(m[3] ?? '');
  if (host === 'task' && rest) return { kind: 'task', id: rest };
  if (host === 'add') return { kind: 'add', text: query.get('text') ?? '' };
  if (host === 'pair') {
    const server = parsePairCode(url);
    return server ? { kind: 'pair', server } : null;
  }
  if (host === 'inbox' || host === 'today' || host === 'upcoming' || host === 'dump') return { kind: 'view', view: host };
  return null;
}
