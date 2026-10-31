/**
 * Database schema and op format, shared by the web app (sql.js) and the sync server (bun:sqlite).
 * Pure: no imports, so the server can load it without the browser build.
 */

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS areas (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, area_id TEXT, name TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
  sort REAL NOT NULL DEFAULT 0, completed_at TEXT);
CREATE TABLE IF NOT EXISTS headings (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, sort REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
  project_id TEXT, area_id TEXT, heading_id TEXT,
  when_date TEXT, evening INTEGER NOT NULL DEFAULT 0, someday INTEGER NOT NULL DEFAULT 0,
  deadline TEXT, completed_at TEXT, created_at TEXT NOT NULL, sort REAL NOT NULL DEFAULT 0,
  urgent INTEGER NOT NULL DEFAULT 0, important INTEGER NOT NULL DEFAULT 0,
  estimate_min INTEGER, rrule TEXT, dump INTEGER NOT NULL DEFAULT 0, dump_section_id TEXT);
CREATE TABLE IF NOT EXISTS checklist (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0, sort REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS task_tags (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, tag_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS habits (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS habit_checks (id TEXT PRIMARY KEY, habit_id TEXT NOT NULL, day TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS time_entries (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT);
CREATE TABLE IF NOT EXISTS dump_sections (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS time_blocks (id TEXT PRIMARY KEY, start_at TEXT NOT NULL, end_at TEXT NOT NULL, title TEXT,
  area_id TEXT, project_id TEXT, task_id TEXT, calendar_id TEXT, created_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE IF NOT EXISTS ops (seq INTEGER PRIMARY KEY AUTOINCREMENT, hlc TEXT NOT NULL, device TEXT NOT NULL,
  tbl TEXT NOT NULL, row_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`;

/** Columns added after the first release: [table, column, declaration]. Applied in order, if missing. */
export const ADDED_COLUMNS: [string, string, string][] = [
  // remote = 1: op arrived from the sync server and must not be pushed back.
  ['ops', 'remote', 'INTEGER NOT NULL DEFAULT 0'],
  // Trash: soft delete, purged 30 days later.
  ['tasks', 'deleted_at', 'TEXT'],
  // Reminders: when to notify (ISO, UTC) and when it was shown.
  ['tasks', 'reminder_at', 'TEXT'],
  ['tasks', 'reminder_sent_at', 'TEXT'],
  // Habit challenges: a fixed length (30/60/75 days) starting on start_date.
  ['habits', 'target_days', 'INTEGER'],
  ['habits', 'start_date', 'TEXT'],
  // Habit schedule: daily | days:1,2,3,4,5 | times:5 (see views.ts).
  ['habits', 'schedule', 'TEXT'],
];

/**
 * Tags used to have UNIQUE(name), so a tag created on two devices could never sync to either.
 * Same-named tags may now coexist; readers merge them with mergeTags(). Run when the stored
 * CREATE TABLE for tags still says UNIQUE.
 */
export const TAGS_DROP_UNIQUE = `
CREATE TABLE tags_rebuild (id TEXT PRIMARY KEY, name TEXT NOT NULL);
INSERT INTO tags_rebuild (id, name) SELECT id, name FROM tags;
DROP TABLE tags;
ALTER TABLE tags_rebuild RENAME TO tags;
`;

/**
 * Merge tags that share a name (ignoring case), as happens when two devices create the same tag
 * before syncing. The tag with the smallest id wins on every device; links to the others point to it.
 */
export function mergeTags<T extends { id: string; name: string }, L extends { tag_id: string }>(tags: T[], links: L[]): { tags: T[]; links: L[] } {
  const canon = new Map<string, T>();
  for (const t of tags) {
    const k = t.name.toLowerCase();
    const c = canon.get(k);
    if (!c || t.id < c.id) canon.set(k, t);
  }
  const alias = new Map<string, string>();
  for (const t of tags) {
    const c = canon.get(t.name.toLowerCase())!;
    if (c.id !== t.id) alias.set(t.id, c.id);
  }
  return {
    tags: tags.filter((t) => canon.get(t.name.toLowerCase()) === t),
    links: alias.size ? links.map((l) => (alias.has(l.tag_id) ? { ...l, tag_id: alias.get(l.tag_id)! } : l)) : links,
  };
}

/** Tables that sync. `ops` and `meta` never leave the device. */
export const SYNC_TABLES = ['areas', 'projects', 'headings', 'tasks', 'checklist', 'tags', 'task_tags', 'habits', 'habit_checks', 'time_entries', 'dump_sections', 'time_blocks'] as const;

export type SqlValue = string | number | null | Uint8Array;
export type Row = Record<string, SqlValue>;

export interface Op {
  seq?: number;
  hlc: string;
  device: string;
  tbl: string;
  row_id: string;
  kind: 'insert' | 'update' | 'delete';
  payload: Row;
}

/** UUIDv7: 48-bit ms timestamp + random. Sortable, generated offline. */
export function uuid7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let ts = Date.now();
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts & 0xff;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Hybrid logical clock: wall ms, logical counter, device. Strings compare in clock order. */
export class Hlc {
  private lastMs = 0;
  private counter = 0;
  constructor(public device: string) {}

  next(): string {
    const now = Date.now();
    if (now > this.lastMs) {
      this.lastMs = now;
      this.counter = 0;
    } else {
      this.counter++;
    }
    return `${String(this.lastMs).padStart(15, '0')}:${String(this.counter).padStart(5, '0')}:${this.device}`;
  }

  /** Receive rule: never issue a clock lower than one seen from another device. */
  observe(h: string) {
    const [msStr, cStr] = h.split(':');
    const ms = Number(msStr);
    const c = Number(cStr);
    if (ms > this.lastMs || (ms === this.lastMs && c > this.counter)) {
      this.lastMs = ms;
      this.counter = c;
    }
  }
}
