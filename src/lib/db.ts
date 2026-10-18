/**
 * Local SQLite (sql.js / WASM) with an append-only op log.
 *
 * Every write goes through insert/update/remove, which apply the change and
 * record an operation (hybrid logical clock + device id). The op log is what a
 * future sync server would receive; the PoC only records it.
 *
 * The database file is persisted to IndexedDB (debounced).
 */
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';

const IDB_NAME = 'openthings';
const IDB_STORE = 'files';
const IDB_KEY = 'db.sqlite';

const SCHEMA = `
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
CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS task_tags (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, tag_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS habits (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS habit_checks (id TEXT PRIMARY KEY, habit_id TEXT NOT NULL, day TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS time_entries (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT);
CREATE TABLE IF NOT EXISTS dump_sections (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS ops (seq INTEGER PRIMARY KEY AUTOINCREMENT, hlc TEXT NOT NULL, device TEXT NOT NULL,
  tbl TEXT NOT NULL, row_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`;

export type Row = Record<string, SqlValue>;

let db: Database;
let device = '';
let lastMs = 0;
let counter = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let memoryOnly = false;
const writeListeners = new Set<() => void>();

/** Called after every local write (not after applying remote ops). */
export function onWrite(fn: () => void): () => void {
  writeListeners.add(fn);
  return () => writeListeners.delete(fn);
}

/** Additive schema migrations for databases created by older versions. */
function migrate() {
  const cols = all<{ name: string }>('PRAGMA table_info(ops)').map((c) => c.name);
  // remote = 1: op arrived from the sync server and must not be pushed back.
  if (!cols.includes('remote')) db.run('ALTER TABLE ops ADD COLUMN remote INTEGER NOT NULL DEFAULT 0');
  const add = (tbl: string, col: string, decl: string) => {
    const have = all<{ name: string }>(`PRAGMA table_info(${tbl})`).map((c) => c.name);
    if (!have.includes(col)) db.run(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${decl}`);
  };
  // Trash: soft delete, purged 30 days later.
  add('tasks', 'deleted_at', 'TEXT');
  // Reminders: when to notify (ISO, UTC) and when it was shown.
  add('tasks', 'reminder_at', 'TEXT');
  add('tasks', 'reminder_sent_at', 'TEXT');
  // Habit challenges: a fixed length (30/60/75 days) starting on start_date.
  add('habits', 'target_days', 'INTEGER');
  add('habits', 'start_date', 'TEXT');
  // Habit schedule: daily | days:1,2,3,4,5 | times:5 (see views.ts).
  add('habits', 'schedule', 'TEXT');
  columnCache.clear();
}

export function deviceId(): string {
  return device;
}

export function metaGet(key: string): string | null {
  const r = one<{ value: string | null }>('SELECT value FROM meta WHERE key = ?', [key]);
  return r?.value ?? null;
}

export function metaSet(key: string, value: string | null) {
  db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
  scheduleSave();
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

/** Hybrid logical clock: wall ms, logical counter, device. Lexically sortable. */
function hlc(): string {
  const now = Date.now();
  // (lastMs/counter also advance in observeHlc when remote ops arrive.)
  if (now > lastMs) {
    lastMs = now;
    counter = 0;
  } else {
    counter++;
  }
  return `${String(lastMs).padStart(15, '0')}:${String(counter).padStart(5, '0')}:${device}`;
}

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(): Promise<Uint8Array | undefined> {
  const idb = await idbOpen();
  return new Promise((resolve, reject) => {
    const req = idb.transaction(IDB_STORE).objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(req.result as Uint8Array | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(data: Uint8Array): Promise<void> {
  const idb = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(data, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function openDb(opts: { memory?: boolean } = {}): Promise<{ fresh: boolean }> {
  const SQL = opts.memory ? await initSqlJs() : await initSqlJs({ locateFile: () => wasmUrl });
  let existing: Uint8Array | undefined;
  if (!opts.memory) {
    try {
      existing = await idbGet();
    } catch {
      existing = undefined;
    }
  }
  memoryOnly = !!opts.memory;
  db = existing ? new SQL.Database(existing) : new SQL.Database();
  db.exec(SCHEMA);
  migrate();
  const d = one('SELECT value FROM meta WHERE key = ?', ['device']);
  if (d) {
    device = String(d.value);
  } else {
    device = uuid7().slice(-12);
    db.run('INSERT INTO meta (key, value) VALUES (?, ?)', ['device', device]);
  }
  return { fresh: !existing };
}

export function all<T = Row>(sql: string, params: SqlValue[] = []): T[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const out: T[] = [];
  while (stmt.step()) out.push(stmt.getAsObject() as T);
  stmt.free();
  return out;
}

export function one<T = Row>(sql: string, params: SqlValue[] = []): T | undefined {
  return all<T>(sql, params)[0];
}

/** HLC receive rule: never issue a clock lower than one we've seen from another device. */
export function observeHlc(h: string) {
  const [msStr, cStr] = h.split(':');
  const ms = Number(msStr);
  const c = Number(cStr);
  if (ms > lastMs || (ms === lastMs && c > counter)) {
    lastMs = ms;
    counter = c;
  }
}

function record(tbl: string, rowId: string, kind: 'insert' | 'update' | 'delete', payload: Row) {
  db.run('INSERT INTO ops (hlc, device, tbl, row_id, kind, payload) VALUES (?, ?, ?, ?, ?, ?)', [
    hlc(),
    device,
    tbl,
    rowId,
    kind,
    JSON.stringify(payload),
  ]);
}

export function insert(tbl: string, row: Row & { id: string }) {
  const cols = Object.keys(row);
  db.run(
    `INSERT INTO ${tbl} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => row[c]),
  );
  record(tbl, row.id, 'insert', row);
  changed();
}

function changed() {
  scheduleSave();
  for (const fn of writeListeners) fn();
}

export function update(tbl: string, id: string, fields: Row) {
  const cols = Object.keys(fields);
  if (!cols.length) return;
  db.run(`UPDATE ${tbl} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [
    ...cols.map((c) => fields[c]),
    id,
  ]);
  // One op per field: per-field last-write-wins on sync.
  for (const c of cols) record(tbl, id, 'update', { [c]: fields[c] });
  changed();
}

export function remove(tbl: string, id: string) {
  db.run(`DELETE FROM ${tbl} WHERE id = ?`, [id]);
  record(tbl, id, 'delete', {});
  changed();
}

// ---------- sync support ----------

export interface Op {
  seq?: number;
  hlc: string;
  device: string;
  tbl: string;
  row_id: string;
  kind: 'insert' | 'update' | 'delete';
  payload: Row;
}

/** Tables that sync. `ops` and `meta` never leave the device. */
export const SYNC_TABLES = ['areas', 'projects', 'headings', 'tasks', 'checklist', 'tags', 'task_tags', 'habits', 'habit_checks', 'time_entries', 'dump_sections'] as const;

const columnCache = new Map<string, Set<string>>();
function columns(tbl: string): Set<string> {
  if (!columnCache.has(tbl)) columnCache.set(tbl, new Set(all<{ name: string }>(`PRAGMA table_info(${tbl})`).map((c) => c.name)));
  return columnCache.get(tbl)!;
}

/** Local ops not yet pushed, oldest first. */
export function pendingOps(limit = 500): Op[] {
  const pushed = Number(metaGet('sync.pushed_seq') ?? 0);
  return all<Op & { payload: string }>('SELECT seq, hlc, device, tbl, row_id, kind, payload FROM ops WHERE remote = 0 AND seq > ? ORDER BY seq LIMIT ?', [pushed, limit]).map(
    (o) => ({ ...o, payload: JSON.parse(o.payload as unknown as string) }),
  );
}

export function pendingCount(): number {
  const pushed = Number(metaGet('sync.pushed_seq') ?? 0);
  return Number(one('SELECT COUNT(*) AS n FROM ops WHERE remote = 0 AND seq > ?', [pushed])?.n ?? 0);
}

export function markPushed(seq: number) {
  metaSet('sync.pushed_seq', String(seq));
}

/**
 * Apply ops from other devices with per-field last-writer-wins on the HLC.
 * Table and column names are checked against the local schema; anything unknown is skipped.
 * Returns the number of ops that changed local data.
 */
export function applyRemoteOps(ops: Op[]): number {
  let applied = 0;
  const sorted = [...ops].sort((a, b) => a.hlc.localeCompare(b.hlc));
  db.run('BEGIN');
  try {
    for (const op of sorted) {
      if (op.device === device) continue;
      if (one('SELECT 1 AS x FROM ops WHERE hlc = ? AND device = ?', [op.hlc, op.device])) continue; // already have it
      observeHlc(op.hlc);
      if (!(SYNC_TABLES as readonly string[]).includes(op.tbl)) continue;
      const cols = columns(op.tbl);
      let changedRow = false;

      if (op.kind === 'delete') {
        db.run(`DELETE FROM ${op.tbl} WHERE id = ?`, [op.row_id]);
        changedRow = true;
      } else if (op.kind === 'insert') {
        const exists = one(`SELECT 1 AS x FROM ${op.tbl} WHERE id = ?`, [op.row_id]);
        const deleted = one('SELECT 1 AS x FROM ops WHERE tbl = ? AND row_id = ? AND kind = ?', [op.tbl, op.row_id, 'delete']);
        const keys = Object.keys(op.payload).filter((k) => cols.has(k));
        if (!exists && !deleted && keys.includes('id')) {
          db.run(`INSERT INTO ${op.tbl} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => op.payload[k]));
          changedRow = true;
        }
      } else if (op.kind === 'update') {
        for (const [field, value] of Object.entries(op.payload)) {
          if (!cols.has(field) || field === 'id') continue;
          // Newest write to this field wins: compare against every op we hold that set it.
          const newer = one(
            `SELECT 1 AS x FROM ops WHERE tbl = ? AND row_id = ? AND kind IN ('insert','update') AND json_type(payload, ?) IS NOT NULL AND hlc > ? LIMIT 1`,
            [op.tbl, op.row_id, `$.${field}`, op.hlc],
          );
          if (newer) continue;
          db.run(`UPDATE ${op.tbl} SET ${field} = ? WHERE id = ?`, [value, op.row_id]);
          changedRow = true;
        }
      }
      db.run('INSERT INTO ops (hlc, device, tbl, row_id, kind, payload, remote) VALUES (?, ?, ?, ?, ?, ?, 1)', [
        op.hlc,
        op.device,
        op.tbl,
        op.row_id,
        op.kind,
        JSON.stringify(op.payload),
      ]);
      if (changedRow) applied++;
    }
    db.run('COMMIT');
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }
  scheduleSave();
  return applied;
}

export function opCount(): number {
  return Number(one('SELECT COUNT(*) AS n FROM ops')?.n ?? 0);
}

export function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}

export async function saveNow() {
  clearTimeout(saveTimer);
  if (db && !memoryOnly) await idbPut(db.export());
}

export async function resetDb() {
  const idb = await idbOpen();
  await new Promise<void>((resolve) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(IDB_KEY);
    tx.oncomplete = () => resolve();
  });
}

export function exportJson(): string {
  const tables = ['areas', 'projects', 'headings', 'tasks', 'checklist', 'tags', 'task_tags', 'habits', 'habit_checks', 'time_entries', 'dump_sections'];
  const out: Record<string, Row[]> = {};
  for (const t of tables) out[t] = all(`SELECT * FROM ${t}`);
  return JSON.stringify({ version: 1, exported_at: new Date().toISOString(), ...out }, null, 2);
}
