import { beforeEach, describe, expect, it } from 'vitest';
import * as db from '../db';
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

describe('op log', () => {
  it('tracks pending ops and marks them pushed', () => {
    addTask('t1', 'one');
    db.update('tasks', 't1', { title: 'two', urgent: 1 });
    const ops = db.pendingOps();
    expect(ops.map((o) => o.kind)).toEqual(['insert', 'update', 'update']);
    db.markPushed(ops[1].seq!);
    expect(db.pendingCount()).toBe(1);
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
