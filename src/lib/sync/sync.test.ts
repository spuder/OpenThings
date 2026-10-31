import { beforeEach, describe, expect, it } from 'vitest';
import * as db from '../db';
import { mergeTags } from '../schema';
import { SyncEngine, normalizeUrl, type Transport } from './engine.svelte';
import { PROTOCOL_VERSION, type SyncRequest } from './protocol';

function addTask(id: string, title: string) {
  db.insert('tasks', {
    id,
    title,
    notes: '',
    project_id: null,
    area_id: null,
    heading_id: null,
    when_date: null,
    evening: 0,
    someday: 0,
    deadline: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    sort: 1,
    urgent: 0,
    important: 0,
    estimate_min: null,
    rrule: null,
    dump: 0,
    dump_section_id: null,
  });
}

const title = (id: string) => db.one<{ title: string }>('SELECT title FROM tasks WHERE id = ?', [id])?.title;
// An HLC from another device, far in the past or future relative to local writes.
const hlcAt = (ms: number, dev = 'otherdevice1') => `${String(ms).padStart(15, '0')}:00000:${dev}`;

beforeEach(async () => {
  await db.openDb({ memory: true });
});

describe('remote ops that collide', () => {
  it('keeps same-named tags from two devices and merges them when read', () => {
    db.insert('tags', { id: 'local-home', name: 'home' });
    const remote = (hlc: string, tbl: string, row_id: string, payload: db.Row) => ({ hlc, device: 'otherdevice1', tbl, row_id, kind: 'insert' as const, payload });
    addTask('t1', 'Water plants');
    db.applyRemoteOps([
      remote(hlcAt(1), 'tags', 'a-remote-home', { id: 'a-remote-home', name: 'Home' }),
      remote(hlcAt(2), 'task_tags', 'tt1', { id: 'tt1', task_id: 't1', tag_id: 'a-remote-home' }),
    ]);
    const merged = mergeTags(db.all<{ id: string; name: string }>('SELECT * FROM tags'), db.all<{ task_id: string; tag_id: string }>('SELECT * FROM task_tags'));
    expect(merged.tags.map((t) => t.id)).toEqual(['a-remote-home']);
    expect(merged.links).toEqual([{ id: 'tt1', task_id: 't1', tag_id: 'a-remote-home' }]);
  });

  it("skips an op that can't apply without blocking the rest", () => {
    const applied = db.applyRemoteOps([
      { hlc: hlcAt(1), device: 'otherdevice1', tbl: 'tasks', row_id: 'bad', kind: 'insert', payload: { id: 'bad' } }, // title is NOT NULL
      { hlc: hlcAt(2), device: 'otherdevice1', tbl: 'tags', row_id: 'g1', kind: 'insert', payload: { id: 'g1', name: 'ok' } },
    ]);
    expect(applied).toBe(1);
    expect(db.one('SELECT 1 AS x FROM tasks WHERE id = ?', ['bad'])).toBeUndefined();
    // Both are recorded, so the next sync doesn't fetch them again.
    expect(db.one<{ n: number }>('SELECT COUNT(*) AS n FROM ops WHERE remote = 1')?.n).toBe(2);
  });
});

describe('op log', () => {
  it('tracks pending ops and marks them pushed', () => {
    addTask('t1', 'one');
    db.update('tasks', 't1', { title: 'two', urgent: 1 });
    const ops = db.pendingOps();
    expect(ops.map((o) => o.kind)).toEqual(['insert', 'update', 'update']);
    db.markPushed(ops[1].seq!);
    expect(db.pendingCount()).toBe(1);
  });

  it('bulk inserts in one transaction and records an op per row', () => {
    const row = (id: string, sort: number) => ({ id, title: id, created_at: 'x', sort });
    db.bulkInsert([
      { tbl: 'tasks', row: row('b1', 1) },
      { tbl: 'tasks', row: row('b2', 2) },
    ]);
    expect(db.pendingOps().filter((o) => o.row_id.startsWith('b')).map((o) => o.kind)).toEqual(['insert', 'insert']);

    // A duplicate id fails the whole batch, not just the bad row.
    expect(() =>
      db.bulkInsert([
        { tbl: 'tasks', row: row('b3', 3) },
        { tbl: 'tasks', row: row('b1', 4) },
      ]),
    ).toThrow();
    expect(db.one('SELECT id FROM tasks WHERE id = ?', ['b3'])).toBeUndefined();
    expect(db.one('SELECT id FROM tasks WHERE id = ?', ['b1'])).toBeTruthy();
  });
});

describe('applyRemoteOps', () => {
  it('inserts, then applies newer updates and ignores older ones per field', () => {
    const base = Date.now();
    db.applyRemoteOps([
      { hlc: hlcAt(base - 10_000), device: 'otherdevice1', tbl: 'tasks', row_id: 'r1', kind: 'insert', payload: { id: 'r1', title: 'remote', notes: '', created_at: 'x', sort: 1 } },
    ]);
    expect(title('r1')).toBe('remote');

    db.update('tasks', 'r1', { title: 'local edit' }); // local HLC is "now"
    db.applyRemoteOps([
      { hlc: hlcAt(base - 5_000), device: 'otherdevice1', tbl: 'tasks', row_id: 'r1', kind: 'update', payload: { title: 'stale', urgent: 1 } },
    ]);
    // Title: local write is newer, kept. Urgent: nobody else wrote it, remote applies.
    expect(title('r1')).toBe('local edit');
    expect(db.one<{ urgent: number }>('SELECT urgent FROM tasks WHERE id = ?', ['r1'])?.urgent).toBe(1);

    db.applyRemoteOps([
      { hlc: hlcAt(base + 60_000), device: 'otherdevice1', tbl: 'tasks', row_id: 'r1', kind: 'update', payload: { title: 'newest' } },
    ]);
    expect(title('r1')).toBe('newest');
  });

  it('skips unknown tables and columns, its own device, and duplicates', () => {
    addTask('t2', 'mine');
    const h = hlcAt(Date.now() + 1000);
    const n = db.applyRemoteOps([
      { hlc: h, device: 'otherdevice1', tbl: 'meta', row_id: 'device', kind: 'update', payload: { value: 'hijack' } },
      { hlc: h, device: 'otherdevice1', tbl: 'tasks', row_id: 't2', kind: 'update', payload: { 'title = 1; --': 'x' } },
      { hlc: hlcAt(Date.now() + 2000, db.deviceId()), device: db.deviceId(), tbl: 'tasks', row_id: 't2', kind: 'update', payload: { title: 'echo' } },
    ]);
    expect(n).toBe(0);
    expect(db.deviceId()).not.toBe('hijack');
    expect(title('t2')).toBe('mine');

    const dup = { hlc: hlcAt(Date.now() + 3_600_000), device: 'otherdevice1', tbl: 'tasks', row_id: 't2', kind: 'update' as const, payload: { title: 'once' } };
    expect(db.applyRemoteOps([dup])).toBe(1);
    expect(db.applyRemoteOps([dup])).toBe(0);
  });

  it('a delete wins over a late insert of the same row', () => {
    db.applyRemoteOps([{ hlc: hlcAt(Date.now() + 1000), device: 'otherdevice1', tbl: 'tasks', row_id: 'gone', kind: 'delete', payload: {} }]);
    db.applyRemoteOps([{ hlc: hlcAt(Date.now() - 1000, 'otherdevice2'), device: 'otherdevice2', tbl: 'tasks', row_id: 'gone', kind: 'insert', payload: { id: 'gone', title: 'zombie', created_at: 'x' } }]);
    expect(title('gone')).toBeUndefined();
  });
});

describe('SyncEngine', () => {
  it('pushes pending ops, applies pulled ops, and reports idle', async () => {
    const received: SyncRequest[] = [];
    const transport: Transport = {
      health: async () => ({ ok: true, server: 'openthings', protocol: PROTOCOL_VERSION }),
      sync: async (_url, body) => {
        received.push(body);
        return {
          accepted: body.ops.length,
          cursor: String(received.length),
          ops:
            received.length === 1
              ? [{ hlc: hlcAt(Date.now() + 5000), device: 'phone0000001', tbl: 'tasks', row_id: 'p1', kind: 'insert', payload: { id: 'p1', title: 'from phone', created_at: 'x' } }]
              : [],
        };
      },
    };
    const engine = new SyncEngine(transport);
    let remoteChanges = 0;
    engine.onRemoteChanges = () => remoteChanges++;
    engine.init();
    addTask('d1', 'from desktop');
    expect(engine.status).toBe('local');

    engine.configure('openthings.example.ts.net/', true);
    expect(engine.serverUrl).toBe('https://openthings.example.ts.net');
    await engine.kick();

    expect(received[0].ops.some((o) => o.row_id === 'd1')).toBe(true);
    expect(received[0].cursor).toBeNull();
    expect(title('p1')).toBe('from phone');
    expect(remoteChanges).toBe(1);
    expect(engine.status).toBe('idle');
    expect(engine.pending).toBe(0);
    expect(engine.lastSyncedAt).not.toBeNull();

    // Switching servers forgets the last sync, so pairing waits for the new server.
    engine.configure('https://other.example.ts.net', true);
    expect(engine.lastSyncedAt).toBeNull();
    engine.configure(null, false);
  });

  it('reports an error with a reason when the server is unreachable', async () => {
    const engine = new SyncEngine({
      health: async () => {
        throw new Error("Can't reach the server");
      },
      sync: async () => {
        throw new Error("Can't reach the server");
      },
    });
    engine.init();
    addTask('d2', 'x');
    engine.configure('https://nowhere.invalid', true);
    await engine.kick();
    expect(engine.status).toBe('error');
    expect(engine.error).toMatch(/reach/);
    expect(engine.pending).toBeGreaterThan(0);
    await expect(engine.test('https://nowhere.invalid')).rejects.toThrow();
  });

  it('normalizes server URLs', () => {
    expect(normalizeUrl(' https://a.b/ ')).toBe('https://a.b');
    expect(normalizeUrl('http://10.0.0.5:8080')).toBe('http://10.0.0.5:8080');
  });
});

describe('time blocks (#99)', () => {
  const blockRow = (id: string) => ({
    id, start_at: '2026-10-31T09:00', end_at: '2026-10-31T10:00', title: null, area_id: 'a1', project_id: null, task_id: null,
    calendar_id: null, created_at: new Date().toISOString(), deleted_at: null,
  });

  it('records local block writes in the op log for sync', () => {
    db.insert('time_blocks', blockRow('b1'));
    db.update('time_blocks', 'b1', { end_at: '2026-10-31T11:00' });
    expect(db.pendingOps().filter((o) => o.tbl === 'time_blocks').map((o) => o.kind)).toEqual(['insert', 'update']);
  });

  it('applies blocks from another device', () => {
    const applied = db.applyRemoteOps([
      { hlc: hlcAt(1000), device: 'otherdevice1', tbl: 'time_blocks', row_id: 'b2', kind: 'insert', payload: blockRow('b2') },
      { hlc: hlcAt(2000), device: 'otherdevice1', tbl: 'time_blocks', row_id: 'b2', kind: 'update', payload: { title: 'Taxes', area_id: null } },
    ]);
    expect(applied).toBe(2);
    expect(db.one('SELECT title, area_id FROM time_blocks WHERE id = ?', ['b2'])).toEqual({ title: 'Taxes', area_id: null });
  });
});
