/**
 * Pure helpers for the native (Capacitor) shells. No Capacitor imports here, so this file is unit tested
 * and safe to import from anywhere.
 *
 * The iOS app writes `buildSnapshot()` as JSON into the shared App Group container; widgets read it.
 * Extensions (Share Sheet, Shortcuts) can't run this web code, so they append `PendingItem`s to a
 * file in the same container and the app imports them through `store.addParsed` (see docs/ios.md).
 */
import type { Parsed } from '../parse';
import { parseDateWord, parseQuickAdd, parseWhen } from '../parse';
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

/** Lists an `openthings://<list>` link can open. */
export const ROUTE_VIEWS = ['inbox', 'today', 'upcoming', 'anytime', 'someday', 'logbook', 'dump', 'habits', 'matrix'] as const;
export type RouteView = (typeof ROUTE_VIEWS)[number];

/**
 * `openthings://add?…`. `text` is quick-add text (tokens are parsed); the other fields are taken
 * literally, so a title with a `#` in it stays a title. `save` adds without showing quick add.
 */
export interface AddLink {
  text: string;
  title: string;
  notes: string;
  when: string;
  deadline: string;
  tags: string[];
  list: string;
  save: boolean;
}

/**
 * Routes from widgets, notifications, Shortcuts, Automator, scripts and pairing QR codes:
 * `openthings://today`, `openthings://task/<id>`, `openthings://add?title=…`, `openthings://pair?server=…`, …
 * `openthings:///add?…` (three slashes, as other apps write them) works the same. See docs/url-scheme.md.
 */
export type Route =
  | { kind: 'view'; view: RouteView }
  | { kind: 'task'; id: string }
  | ({ kind: 'add' } & AddLink)
  | { kind: 'pair'; server: string };

const TRUE = new Set(['1', 'true', 'yes']);

export function parseRoute(url: string): Route | null {
  // openthings:///add → openthings://add
  const link = url.trim().replace(/^openthings:\/\/\//i, 'openthings://');
  const m = /^openthings:\/\/([^/?#]*)\/?([^?#]*)(?:\?([^#]*))?/i.exec(link);
  if (!m) return null;
  const host = m[1].toLowerCase();
  const rest = decodeURIComponent(m[2] ?? '');
  const query = new URLSearchParams(m[3] ?? '');
  const get = (k: string) => (query.get(k) ?? '').trim();
  if (host === 'task' && rest) return { kind: 'task', id: rest };
  if (host === 'add') {
    return {
      kind: 'add',
      text: query.get('text') ?? '',
      title: get('title'),
      notes: query.get('notes') ?? '',
      when: get('when'),
      deadline: get('deadline'),
      tags: query
        .getAll('tags')
        .flatMap((t) => t.split(','))
        .map((t) => t.trim())
        .filter(Boolean),
      list: get('list'),
      save: TRUE.has(get('save').toLowerCase()),
    };
  }
  if (host === 'pair') {
    const server = parsePairCode(link);
    return server ? { kind: 'pair', server } : null;
  }
  if ((ROUTE_VIEWS as readonly string[]).includes(host)) return { kind: 'view', view: host as RouteView };
  return null;
}

/** A date word from a link: spaces work like hyphens ("next week" = next-week). */
const word = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '-');

/** The to-do an add link describes: `text` parsed as quick add, then the literal fields on top. */
export function addLinkParsed(r: AddLink, day: string): Parsed {
  const p = parseQuickAdd(r.text, day);
  if (r.title) p.title = r.title;
  if (r.notes) p.notes = p.notes ? `${p.notes}\n${r.notes}` : r.notes;
  if (r.when) {
    const w = parseWhen(word(r.when), day);
    if (w) p.when = w;
    else p.warnings.push(`Unknown when: ${r.when}`);
  }
  if (r.deadline) {
    const d = parseDateWord(word(r.deadline), day);
    if (d) p.deadline = d;
    else p.warnings.push(`Unknown deadline: ${r.deadline}`);
  }
  for (const t of r.tags) if (!p.tags.some((x) => x.toLowerCase() === t.toLowerCase())) p.tags.push(t);
  if (r.list) p.project = r.list;
  return p;
}

/** Quick-add text for an add link that opens quick add, so the fields show as tokens to review. */
export function addLinkPrefill(r: AddLink): string {
  const dash = (s: string) => s.trim().replace(/\s+/g, '-');
  const parts = [
    r.title,
    r.text,
    ...r.tags.map((t) => `#${dash(t)}`),
    r.list && `+${dash(r.list)}`,
    r.when && `@${word(r.when)}`,
    r.deadline && `!${word(r.deadline)}`,
  ].filter(Boolean);
  const text = parts.join(' ');
  return r.notes ? `${text} // ${r.notes}` : text;
}

/** Where a to-do saved by an add link lands, for the "Added to …" notification. */
export function addedTo(p: Pick<Parsed, 'dump' | 'when' | 'project'>): string {
  if (p.dump) return 'Brain Dump';
  if (p.project) return p.project;
  if (!p.when) return 'Inbox';
  return 'OpenThings';
}

/** True for an add link that saves without showing quick add (`save=1`): nothing on screen changes. */
export function isBackgroundAdd(url: string): boolean {
  const r = parseRoute(url);
  return !!r && r.kind === 'add' && !!r.save;
}
