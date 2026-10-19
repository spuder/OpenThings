/**
 * Local SQLite (sql.js / WASM) with an append-only op log.
 *
 * Every write goes through insert/update/remove, which apply the change and
 * record an operation (hybrid logical clock + device id). The sync engine pushes
 * the op log to the server and applies other devices' ops (src/lib/sync/).
 * Schema and op format are shared with the server (schema.ts).
 *
 * The database file is persisted to IndexedDB (debounced).
 */
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { ADDED_COLUMNS, Hlc, SCHEMA, SYNC_TABLES, TAGS_DROP_UNIQUE, uuid7, type Op, type Row } from './schema';

export { SYNC_TABLES, uuid7, type Op, type Row };

const IDB_NAME = 'openthings';
const IDB_STORE = 'files';
const IDB_KEY = 'db.sqlite';

let db: Database;
let device = '';
let clock = new Hlc('');
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
  for (const [tbl, col, decl] of ADDED_COLUMNS) {
    const have = all<{ name: string }>(`PRAGMA table_info(${tbl})`).map((c) => c.name);
    if (!have.includes(col)) db.run(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${decl}`);
  }
  const tagsSql = one<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tags'")?.sql ?? '';
  if (/unique/i.test(tagsSql)) db.exec(`BEGIN; ${TAGS_DROP_UNIQUE} COMMIT;`);
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
  clock = new Hlc(device);
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
  clock.observe(h);
}

function record(tbl: string, rowId: string, kind: 'insert' | 'update' | 'delete', payload: Row) {
  db.run('INSERT INTO ops (hlc, device, tbl, row_id, kind, payload) VALUES (?, ?, ?, ?, ?, ?)', [
    clock.next(),
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

export interface BulkInsert {
  tbl: string;
  row: Row & { id: string };
}

/**
 * Insert many rows in one transaction, recording one op per row like insert().
 * If any row fails, nothing is written. Saves and notifies once at the end, so a
 * large import (thousands of to-dos) doesn't re-render the app per row.
 */
export function bulkInsert(items: BulkInsert[]) {
  if (!items.length) return;
  db.run('BEGIN');
  try {
    for (const { tbl, row } of items) {
      const cols = Object.keys(row);
      db.run(
        `INSERT INTO ${tbl} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map((c) => row[c]),
      );
      record(tbl, row.id, 'insert', row);
    }
    db.run('COMMIT');
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }
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
      // One op that can't apply (a constraint, a bad value) must not block every later sync:
      // undo just that op's changes, keep the op so it isn't fetched again, and move on.
      db.run('SAVEPOINT op');
      let changedRow = false;
      try {
        changedRow = applyOne(op);
        db.run('RELEASE op');
      } catch (e) {
        db.run('ROLLBACK TO op');
        db.run('RELEASE op');
        console.warn(`Skipped remote ${op.kind} ${op.tbl}/${op.row_id}: ${(e as Error).message}`);
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

/** Apply one remote op to the data tables. Returns true if local data changed. */
function applyOne(op: Op): boolean {
  const cols = columns(op.tbl);
  if (op.kind === 'delete') {
    db.run(`DELETE FROM ${op.tbl} WHERE id = ?`, [op.row_id]);
    return true;
  }
  if (op.kind === 'insert') {
    const exists = one(`SELECT 1 AS x FROM ${op.tbl} WHERE id = ?`, [op.row_id]);
    const deleted = one('SELECT 1 AS x FROM ops WHERE tbl = ? AND row_id = ? AND kind = ?', [op.tbl, op.row_id, 'delete']);
    const keys = Object.keys(op.payload).filter((k) => cols.has(k));
    if (exists || deleted || !keys.includes('id')) return false;
    db.run(`INSERT INTO ${op.tbl} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => op.payload[k]));
    return true;
  }
  let changed = false;
  for (const [field, value] of Object.entries(op.payload)) {
    if (!cols.has(field) || field === 'id') continue;
    // Newest write to this field wins: compare against every op we hold that set it.
    const newer = one(
      `SELECT 1 AS x FROM ops WHERE tbl = ? AND row_id = ? AND kind IN ('insert','update') AND json_type(payload, ?) IS NOT NULL AND hlc > ? LIMIT 1`,
      [op.tbl, op.row_id, `$.${field}`, op.hlc],
    );
    if (newer) continue;
    db.run(`UPDATE ${op.tbl} SET ${field} = ? WHERE id = ?`, [value, op.row_id]);
    changed = true;
  }
  return changed;
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
