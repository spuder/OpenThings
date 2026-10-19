/**
 * Server database (bun:sqlite): every op from every device, plus the current state materialized
 * from them with the same rules as the app (per-field last writer wins by HLC; delete wins).
 *
 * The REST API and MCP tools read the materialized tables and write through insert/update/remove,
 * which record ops under the server's own device id; devices pull those like any other device's.
 */
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { ADDED_COLUMNS, Hlc, SCHEMA, SYNC_TABLES, TAGS_DROP_UNIQUE, uuid7, type Op, type Row, type SqlValue } from '../src/lib/schema';

const HLC_RE = /^\d{15}:\d{5}:[A-Za-z0-9_-]{1,64}$/;
const NAME_RE = /^[a-z_][a-z0-9_]{0,63}$/;
const DEVICE_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Check an op received from a client. Returns a clean copy, or null if it's malformed. */
export function validOp(x: unknown): Op | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.hlc !== 'string' || !HLC_RE.test(o.hlc)) return null;
  if (typeof o.device !== 'string' || !DEVICE_RE.test(o.device)) return null;
  if (typeof o.tbl !== 'string' || !NAME_RE.test(o.tbl)) return null;
  if (typeof o.row_id !== 'string' || !o.row_id || o.row_id.length > 128) return null;
  if (o.kind !== 'insert' && o.kind !== 'update' && o.kind !== 'delete') return null;
  if (!o.payload || typeof o.payload !== 'object' || Array.isArray(o.payload)) return null;
  const payload: Row = {};
  for (const [k, v] of Object.entries(o.payload as Record<string, unknown>)) {
    if (!NAME_RE.test(k)) return null;
    if (v === null || typeof v === 'string' || typeof v === 'number') payload[k] = v;
    else if (typeof v === 'boolean') payload[k] = v ? 1 : 0;
    else return null;
  }
  return { hlc: o.hlc, device: o.device, tbl: o.tbl, row_id: o.row_id, kind: o.kind, payload };
}

export class ServerDb {
  readonly sql: Database;
  readonly device: string;
  /** Identifies this database; part of every cursor, so a reset server makes clients start over. */
  readonly epoch: string;
  private clock: Hlc;
  private columnCache = new Map<string, Set<string>>();
  /** Called after any change to materialized data (pushes, REST and MCP writes). */
  onChange: () => void = () => {};

  constructor(path = ':memory:') {
    this.sql = new Database(path, { create: true });
    this.sql.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.sql.exec(SCHEMA);
    for (const [tbl, col, decl] of ADDED_COLUMNS) {
      if (!this.columns(tbl).has(col)) this.sql.exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${decl}`);
      this.columnCache.delete(tbl);
    }
    const tagsSql = this.one<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tags'")?.sql ?? '';
    if (/unique/i.test(tagsSql)) this.sql.transaction(() => this.sql.exec(TAGS_DROP_UNIQUE))();
    this.sql.exec('CREATE UNIQUE INDEX IF NOT EXISTS ops_hlc_device ON ops (hlc, device)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS ops_row ON ops (tbl, row_id)');
    this.device = this.metaGet('device') ?? this.metaInit('device', `srv${uuid7().slice(-9)}`);
    this.epoch = this.metaGet('epoch') ?? this.metaInit('epoch', uuid7().replaceAll('-', '').slice(-16));
    this.clock = new Hlc(this.device);
    const last = this.one<{ hlc: string }>('SELECT hlc FROM ops ORDER BY hlc DESC LIMIT 1');
    if (last) this.clock.observe(last.hlc);
  }

  all<T = Row>(sql: string, params: SqlValue[] = []): T[] {
    return this.sql.query(sql).all(...(params as SQLQueryBindings[])) as T[];
  }

  one<T = Row>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  private run(sql: string, params: SqlValue[] = []) {
    return this.sql.query(sql).run(...(params as SQLQueryBindings[]));
  }

  metaGet(key: string): string | null {
    return this.one<{ value: string | null }>('SELECT value FROM meta WHERE key = ?', [key])?.value ?? null;
  }

  private metaInit(key: string, value: string): string {
    this.run('INSERT INTO meta (key, value) VALUES (?, ?)', [key, value]);
    return value;
  }

  columns(tbl: string): Set<string> {
    if (!this.columnCache.has(tbl)) this.columnCache.set(tbl, new Set(this.all<{ name: string }>(`PRAGMA table_info(${tbl})`).map((c) => c.name)));
    return this.columnCache.get(tbl)!;
  }

  /** Run several writes atomically; listeners hear about it once. */
  tx<T>(fn: () => T): T {
    const out = this.sql.transaction(fn)();
    this.onChange();
    return out;
  }

  // ---------- sync ----------

  /** Store ops pushed by a device and apply them. Returns how many were new. */
  push(ops: Op[]): number {
    if (!ops.length) return 0;
    const sorted = [...ops].sort((a, b) => a.hlc.localeCompare(b.hlc));
    let accepted = 0;
    this.tx(() => {
      for (const op of sorted) {
        if (this.one('SELECT 1 AS x FROM ops WHERE hlc = ? AND device = ?', [op.hlc, op.device])) continue;
        this.clock.observe(op.hlc);
        try {
          this.materialize(op);
        } catch (e) {
          // A row that can't be applied (e.g. a NOT NULL column missing) is skipped here, but the op
          // is still stored and relayed so devices converge on the same log.
          console.warn(`skipped ${op.kind} ${op.tbl}/${op.row_id}: ${(e as Error).message}`);
        }
        this.recordOp(op);
        accepted++;
      }
    });
    return accepted;
  }

  /** Ops from other devices after `cursor`, oldest first. */
  pull(device: string, cursor: string | null, limit = 1000): { ops: Op[]; cursor: string; more: boolean } {
    let after = 0;
    const m = /^([0-9a-f]+)\.(\d+)$/.exec(cursor ?? '');
    if (m && m[1] === this.epoch) after = Number(m[2]);
    const rows = this.all<Op & { seq: number; payload: string }>(
      'SELECT seq, hlc, device, tbl, row_id, kind, payload FROM ops WHERE seq > ? AND device != ? ORDER BY seq LIMIT ?',
      [after, device, limit + 1],
    );
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = more ? page.at(-1)!.seq : Number(this.one<{ n: number | null }>('SELECT MAX(seq) AS n FROM ops')?.n ?? 0);
    return {
      ops: page.map(({ seq: _seq, payload, ...o }) => ({ ...o, payload: JSON.parse(payload) })),
      cursor: `${this.epoch}.${Math.max(last, after)}`,
      more,
    };
  }

  opCount(): number {
    return Number(this.one<{ n: number }>('SELECT COUNT(*) AS n FROM ops')?.n ?? 0);
  }

  private recordOp(op: Op) {
    this.run('INSERT INTO ops (hlc, device, tbl, row_id, kind, payload, remote) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      op.hlc,
      op.device,
      op.tbl,
      op.row_id,
      op.kind,
      JSON.stringify(op.payload),
      op.device === this.device ? 0 : 1,
    ]);
  }

  /** Apply one op to the materialized tables (it is not in the ops table yet). */
  private materialize(op: Op) {
    if (!(SYNC_TABLES as readonly string[]).includes(op.tbl)) return; // newer client's table: relay only
    const cols = this.columns(op.tbl);
    if (op.kind === 'delete') {
      this.run(`DELETE FROM ${op.tbl} WHERE id = ?`, [op.row_id]);
      return;
    }
    if (op.kind === 'insert') {
      if (op.payload.id !== op.row_id) return;
      if (this.one(`SELECT 1 AS x FROM ${op.tbl} WHERE id = ?`, [op.row_id])) return;
      if (this.one("SELECT 1 AS x FROM ops WHERE tbl = ? AND row_id = ? AND kind = 'delete'", [op.tbl, op.row_id])) return;
      const keys = Object.keys(op.payload).filter((k) => cols.has(k));
      this.run(`INSERT INTO ${op.tbl} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => op.payload[k]));
      // Updates that arrived before their insert (from another device) still win.
      const later = this.all<{ payload: string }>("SELECT payload FROM ops WHERE tbl = ? AND row_id = ? AND kind = 'update' AND hlc > ? ORDER BY hlc", [
        op.tbl,
        op.row_id,
        op.hlc,
      ]);
      for (const u of later) this.setFields(op.tbl, op.row_id, JSON.parse(u.payload));
      return;
    }
    const fresh: Row = {};
    for (const [field, value] of Object.entries(op.payload)) {
      if (!cols.has(field) || field === 'id') continue;
      const newer = this.one(
        "SELECT 1 AS x FROM ops WHERE tbl = ? AND row_id = ? AND kind IN ('insert','update') AND json_type(payload, ?) IS NOT NULL AND hlc > ? LIMIT 1",
        [op.tbl, op.row_id, `$.${field}`, op.hlc],
      );
      if (!newer) fresh[field] = value;
    }
    this.setFields(op.tbl, op.row_id, fresh);
  }

  private setFields(tbl: string, id: string, fields: Row) {
    const cols = this.columns(tbl);
    const keys = Object.keys(fields).filter((k) => cols.has(k) && k !== 'id');
    if (!keys.length) return;
    this.run(`UPDATE ${tbl} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => fields[k]), id]);
  }

  // ---------- local writes (REST API, MCP) ----------
  // Same shape as the app's db.insert / update / remove: apply, then record an op per change.

  insert(tbl: string, row: Row & { id: string }) {
    const cols = Object.keys(row);
    this.run(`INSERT INTO ${tbl} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => row[c]));
    this.recordOp({ hlc: this.clock.next(), device: this.device, tbl, row_id: row.id, kind: 'insert', payload: row });
  }

  update(tbl: string, id: string, fields: Row) {
    const cols = Object.keys(fields);
    if (!cols.length) return;
    this.setFields(tbl, id, fields);
    // One op per field: per-field last-write-wins on sync.
    for (const c of cols) this.recordOp({ hlc: this.clock.next(), device: this.device, tbl, row_id: id, kind: 'update', payload: { [c]: fields[c] } });
  }

  remove(tbl: string, id: string) {
    this.run(`DELETE FROM ${tbl} WHERE id = ?`, [id]);
    this.recordOp({ hlc: this.clock.next(), device: this.device, tbl, row_id: id, kind: 'delete', payload: {} });
  }

  close() {
    this.sql.close();
  }
}
