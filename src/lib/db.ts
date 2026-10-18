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

export async function openDb(): Promise<{ fresh: boolean }> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  let existing: Uint8Array | undefined;
  try {
    existing = await idbGet();
  } catch {
    existing = undefined;
  }
  db = existing ? new SQL.Database(existing) : new SQL.Database();
  db.exec(SCHEMA);
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
  scheduleSave();
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
  scheduleSave();
}

export function remove(tbl: string, id: string) {
  db.run(`DELETE FROM ${tbl} WHERE id = ?`, [id]);
  record(tbl, id, 'delete', {});
  scheduleSave();
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
  if (db) await idbPut(db.export());
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
