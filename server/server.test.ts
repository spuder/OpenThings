import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Op } from '../src/lib/schema';
import { createApp } from './app';
import { ServerDb } from './db';
import { Service } from './service';

const TODAY = '2026-10-18';

function setup() {
  const db = new ServerDb();
  const service = new Service(db, () => TODAY);
  const app = createApp({ db, service, version: 'test' });
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app(
      new Request(`http://ot.test${path}`, {
        method,
        headers: { host: 'ot.test', 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  };
  return { db, service, call };
}

let ms = 1_790_000_000_000;
function op(device: string, tbl: string, row_id: string, kind: Op['kind'], payload: Op['payload'], at = ms++): Op {
  return { hlc: `${String(at).padStart(15, '0')}:00000:${device}`, device, tbl, row_id, kind, payload };
}
const task = (id: string, title: string) => ({ id, title, notes: '', created_at: '2026-10-18T10:00:00.000Z', sort: 1, evening: 0, someday: 0, urgent: 0, important: 0, dump: 0 });
const sync = (call: ReturnType<typeof setup>['call'], device: string, ops: Op[], cursor: string | null = null) => call('POST', '/api/sync', { protocol: 0, device, cursor, ops });

describe('sync', () => {
  it('reports health', async () => {
    const { call } = setup();
    const r = await call('GET', '/api/health');
    expect(r.body).toEqual({ ok: true, server: 'openthings', protocol: 0, version: 'test' });
  });

  it('reports the public URL when one is set', async () => {
    const app = createApp({ db: new ServerDb(), version: 'test', publicUrl: 'https://openthings.tail1234.ts.net' });
    const res = await app(new Request('http://ot.test/api/health', { headers: { host: 'ot.test' } }));
    expect(await res.json()).toMatchObject({ server: 'openthings', publicUrl: 'https://openthings.tail1234.ts.net' });
  });

  it('relays ops between devices, not back to the sender', async () => {
    const { call, db } = setup();
    const a = await sync(call, 'devA', [op('devA', 'tasks', 't1', 'insert', task('t1', 'Milk'))]);
    expect(a.body.accepted).toBe(1);
    expect(a.body.ops).toEqual([]);
    const b = await sync(call, 'devB', []);
    expect(b.body.ops.map((o: Op) => o.row_id)).toEqual(['t1']);
    expect(db.one('SELECT title FROM tasks WHERE id = ?', ['t1'])).toEqual({ title: 'Milk' });
    // Next pull from the cursor is empty.
    const again = await sync(call, 'devB', [], b.body.cursor);
    expect(again.body.ops).toEqual([]);
  });

  it('dedupes pushed ops on hlc + device', async () => {
    const { call, db } = setup();
    const o = op('devA', 'tasks', 't1', 'insert', task('t1', 'Milk'));
    await sync(call, 'devA', [o]);
    const r = await sync(call, 'devA', [o]);
    expect(r.body.accepted).toBe(0);
    expect(db.opCount()).toBe(1);
  });

  it('resolves conflicts per field, last writer wins, regardless of arrival order', async () => {
    const { call, db } = setup();
    await sync(call, 'devA', [op('devA', 'tasks', 't1', 'insert', task('t1', 'Milk'))]);
    const newer = op('devB', 'tasks', 't1', 'update', { title: 'Oat milk' }, ms + 100);
    const older = op('devA', 'tasks', 't1', 'update', { title: 'Whole milk' }, ms + 50);
    const notes = op('devA', 'tasks', 't1', 'update', { notes: '2 cartons' }, ms + 60);
    await sync(call, 'devB', [newer]);
    await sync(call, 'devA', [older, notes]);
    expect(db.one('SELECT title, notes FROM tasks WHERE id = ?', ['t1'])).toEqual({ title: 'Oat milk', notes: '2 cartons' });
  });

  it('applies updates that arrived before their insert', async () => {
    const { call, db } = setup();
    const ins = op('devA', 'tasks', 't1', 'insert', task('t1', 'Milk'));
    const upd = op('devB', 'tasks', 't1', 'update', { title: 'Bread' });
    await sync(call, 'devB', [upd]);
    await sync(call, 'devA', [ins]);
    expect(db.one('SELECT title FROM tasks WHERE id = ?', ['t1'])).toEqual({ title: 'Bread' });
  });

  it('lets a delete win over a late insert', async () => {
    const { call, db } = setup();
    await sync(call, 'devB', [op('devB', 'tasks', 't1', 'delete', {}, ms + 1000)]);
    await sync(call, 'devA', [op('devA', 'tasks', 't1', 'insert', task('t1', 'Milk'))]);
    expect(db.one('SELECT 1 AS x FROM tasks WHERE id = ?', ['t1'])).toBeUndefined();
  });

  it('skips malformed ops and unknown columns, relays unknown tables', async () => {
    const { call, db } = setup();
    const r = await sync(call, 'devA', [
      { hlc: 'garbage', device: 'devA', tbl: 'tasks', row_id: 'x', kind: 'insert', payload: {} } as Op,
      op('devA', 'tasks; DROP TABLE tasks', 'x', 'insert', {}),
      op('devA', 'tasks', 't1', 'insert', { ...task('t1', 'Milk'), color: 'red' }),
      op('devA', 'future_table', 'f1', 'insert', { id: 'f1' }),
    ]);
    expect(r.status).toBe(200);
    expect(r.body.accepted).toBe(2);
    expect(db.one('SELECT title FROM tasks WHERE id = ?', ['t1'])).toEqual({ title: 'Milk' });
    expect((await sync(call, 'devB', [])).body.ops.map((o: Op) => o.tbl)).toEqual(['tasks', 'future_table']);
  });

  it('accepts the same tag name from two devices and shows it once', async () => {
    const { call } = setup();
    await sync(call, 'devA', [op('devA', 'tags', 'b-home', 'insert', { id: 'b-home', name: 'home' }), op('devA', 'tasks', 't1', 'insert', task('t1', 'Milk')), op('devA', 'task_tags', 'l1', 'insert', { id: 'l1', task_id: 't1', tag_id: 'b-home' })]);
    await sync(call, 'devB', [op('devB', 'tags', 'a-home', 'insert', { id: 'a-home', name: 'Home' }), op('devB', 'tasks', 't2', 'insert', task('t2', 'Bread')), op('devB', 'task_tags', 'l2', 'insert', { id: 'l2', task_id: 't2', tag_id: 'a-home' })]);
    const tags = (await call('GET', '/api/v1/tags')).body.tags;
    expect(tags).toEqual([{ id: 'a-home', name: 'Home', open: 2 }]);
    expect((await call('GET', '/api/v1/tasks?tag=home')).body.tasks.map((t: { id: string }) => t.id).sort()).toEqual(['t1', 't2']);
  });

  it('drops the old UNIQUE tag constraint from an existing database', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ot-')), 'old.sqlite');
    const old = new Database(path);
    old.exec("CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE); INSERT INTO tags VALUES ('g1', 'home');");
    old.close();
    const db = new ServerDb(path);
    db.push([op('devA', 'tags', 'g2', 'insert', { id: 'g2', name: 'home' })]);
    expect(db.all('SELECT id FROM tags ORDER BY id')).toEqual([{ id: 'g1' }, { id: 'g2' }]);
    db.close();
  });

  it('pages pulls with more: true', async () => {
    const { db } = setup();
    db.push(Array.from({ length: 5 }, (_, i) => op('devA', 'tags', `g${i}`, 'insert', { id: `g${i}`, name: `tag${i}` })));
    const first = db.pull('devB', null, 2);
    expect(first.ops.length).toBe(2);
    expect(first.more).toBe(true);
    const second = db.pull('devB', first.cursor, 2);
    const third = db.pull('devB', second.cursor, 2);
    expect(third.more).toBe(false);
    expect([...first.ops, ...second.ops, ...third.ops].map((o) => o.row_id)).toEqual(['g0', 'g1', 'g2', 'g3', 'g4']);
  });

  it('starts over when the cursor is from another server', async () => {
    const { db } = setup();
    db.push([op('devA', 'tags', 'g1', 'insert', { id: 'g1', name: 'home' })]);
    expect(db.pull('devB', 'deadbeefdeadbeef.99').ops.length).toBe(1);
  });

  it('rejects another protocol version', async () => {
    const { call } = setup();
    const r = await call('POST', '/api/sync', { protocol: 99, device: 'devA', cursor: null, ops: [] });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('protocol');
  });

  it('sends REST and MCP changes to devices as ops from the server', async () => {
    const { call, db } = setup();
    await call('POST', '/api/v1/tasks', { text: 'Buy milk #errand' });
    const r = await sync(call, 'devA', []);
    const kinds = r.body.ops.map((o: Op) => `${o.kind} ${o.tbl}`);
    expect(kinds).toEqual(['insert tasks', 'insert tags', 'insert task_tags']);
    expect(r.body.ops.every((o: Op) => o.device === db.device)).toBe(true);
  });
});

describe('REST API', () => {
  it('adds with quick-add syntax and lists views', async () => {
    const { call } = setup();
    const r = await call('POST', '/api/v1/tasks', { text: 'Call dentist +Health @today !2026-10-20 #phone ~15m // ask about x-rays' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ title: 'Call dentist', notes: 'ask about x-rays', when_date: TODAY, deadline: '2026-10-20', project: 'Health', tags: ['phone'], estimate_min: 15 });
    await call('POST', '/api/v1/tasks', { text: 'Someday thing @someday' });
    await call('POST', '/api/v1/tasks', { title: 'Literal #not-a-tag' });
    const today = await call('GET', '/api/v1/tasks?view=today');
    expect(today.body.tasks.map((t: { title: string }) => t.title)).toEqual(['Call dentist']);
    expect((await call('GET', '/api/v1/tasks?view=inbox')).body.tasks.map((t: { title: string }) => t.title)).toEqual(['Literal #not-a-tag']);
    expect((await call('GET', '/api/v1/tasks?project=health')).body.tasks.length).toBe(1);
    expect((await call('GET', '/api/v1/tasks?q=dentist')).body.tasks.length).toBe(1);
    expect((await call('GET', '/api/v1/tasks?view=nope')).status).toBe(400);
  });

  it('updates, completes, trashes and restores', async () => {
    const { call } = setup();
    const { body: t } = await call('POST', '/api/v1/tasks', { text: 'Water plants #home' });
    const p = await call('PATCH', `/api/v1/tasks/${t.id}`, { when: 'tomorrow', add_tags: ['garden'], remove_tags: ['home'], reminder: '9am' });
    expect(p.body).toMatchObject({ when_date: '2026-10-19', tags: ['garden'] });
    expect(p.body.reminder_at).toBeTruthy();
    const done = await call('POST', `/api/v1/tasks/${t.id}/complete`);
    expect(done.body.task.completed_at).toBeTruthy();
    expect((await call('GET', '/api/v1/tasks?view=logbook')).body.tasks.length).toBe(1);
    await call('DELETE', `/api/v1/tasks/${t.id}`);
    expect((await call('GET', '/api/v1/tasks?view=trash')).body.tasks.length).toBe(1);
    await call('POST', `/api/v1/tasks/${t.id}/restore`);
    expect((await call('GET', '/api/v1/tasks?view=trash')).body.tasks.length).toBe(0);
    expect((await call('GET', '/api/v1/tasks/missing')).status).toBe(404);
  });

  it('schedules the next occurrence when completing a repeating to-do', async () => {
    const { call } = setup();
    const { body: t } = await call('POST', '/api/v1/tasks', { text: 'Stretch *daily #health' });
    const r = await call('POST', `/api/v1/tasks/${t.id}/complete`);
    expect(r.body.next).toMatchObject({ title: 'Stretch', when_date: '2026-10-19', tags: ['health'], completed_at: null });
  });

  it('moves out of the brain dump', async () => {
    const { call } = setup();
    await call('POST', '/api/v1/projects', { name: 'Garden' });
    const { body: t } = await call('POST', '/api/v1/tasks', { text: 'Idea @dump' });
    expect(t.dump).toBe(1);
    const m = await call('POST', `/api/v1/tasks/${t.id}/move`, { project: 'garden' });
    expect(m.body).toMatchObject({ dump: 0, project: 'Garden' });
    expect((await call('POST', `/api/v1/tasks/${t.id}/move`, { project: 'Nope' })).status).toBe(404);
  });

  it('checks habits in and out', async () => {
    const { call } = setup();
    const { body: h } = await call('POST', '/api/v1/habits', { text: 'Gym 4x 60d' });
    expect(h).toMatchObject({ name: 'Gym', schedule: 'times:4', target_days: 60 });
    const c = await call('POST', '/api/v1/habits/gym/check', {});
    expect(c.body.checked_today).toBe(true);
    const u = await call('DELETE', `/api/v1/habits/${h.id}/check`);
    expect(u.body.checked_today).toBe(false);
  });

  it('tracks time, one timer at a time', async () => {
    const { call } = setup();
    const { body: a } = await call('POST', '/api/v1/tasks', { text: 'Write report' });
    const { body: b } = await call('POST', '/api/v1/tasks', { text: 'Email' });
    await call('POST', '/api/v1/timers/start', { task_id: a.id });
    await call('POST', '/api/v1/timers/start', { task_id: b.id });
    expect((await call('GET', '/api/v1/timers')).body.running.entry.task_id).toBe(b.id);
    expect((await call('POST', '/api/v1/timers/stop')).body.stopped.entry.task_id).toBe(b.id);
    expect((await call('GET', '/api/v1/timers')).body.running).toBeNull();
  });
});

describe('origins', () => {
  it('blocks other websites, allows native shells and the same host', async () => {
    const { call } = setup();
    expect((await call('GET', '/api/v1/tasks', undefined, { origin: 'https://evil.example' })).status).toBe(403);
    const native = await call('GET', '/api/v1/tasks', undefined, { origin: 'capacitor://localhost' });
    expect(native.status).toBe(200);
    expect(native.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
    const same = await call('GET', '/api/v1/tasks', undefined, { origin: 'https://ot.test' });
    expect(same.status).toBe(200);
    expect(same.headers.get('access-control-allow-origin')).toBeNull();
    expect((await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.example' })).status).toBe(403);
  });
});

describe('MCP', () => {
  /** id null sends a notification (no id). */
  const rpc = (call: ReturnType<typeof setup>['call'], method: string, params?: unknown, id: number | null = 1) =>
    call('POST', '/mcp', id === null ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params });
  const tool = async (call: ReturnType<typeof setup>['call'], name: string, args: unknown) => {
    const r = await rpc(call, 'tools/call', { name, arguments: args });
    return { isError: !!r.body.result.isError, text: r.body.result.content[0].text as string };
  };

  it('initializes and lists tools', async () => {
    const { call } = setup();
    const init = await rpc(call, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(init.body.result.protocolVersion).toBe('2025-06-18');
    expect(init.body.result.capabilities.tools).toBeTruthy();
    expect((await rpc(call, 'notifications/initialized', undefined, null)).status).toBe(202);
    const names = (await rpc(call, 'tools/list')).body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('add_task');
    expect(names).toContain('check_habit');
    expect((await rpc(call, 'nope')).body.error.code).toBe(-32601);
  });

  it('adds, lists and completes through tools', async () => {
    const { call } = setup();
    const added = JSON.parse((await tool(call, 'add_task', { text: 'Book flights @today #travel' })).text);
    expect(added).toMatchObject({ title: 'Book flights', when: TODAY, tags: ['travel'] });
    const list = JSON.parse((await tool(call, 'list_tasks', {})).text);
    expect(list.tasks.map((t: { id: string }) => t.id)).toEqual([added.id]);
    const done = JSON.parse((await tool(call, 'complete_task', { id: added.id })).text);
    expect(done.completed.completed_at).toBeTruthy();
    const dump = JSON.parse((await tool(call, 'brain_dump', { text: 'Random idea' })).text);
    expect(dump.brain_dump).toBe(true);
  });

  it('reports bad input as a tool error', async () => {
    const { call } = setup();
    const r = await tool(call, 'complete_task', { id: 'missing' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('No to-do');
  });

  it('answers batches', async () => {
    const { call } = setup();
    const r = await call('POST', '/mcp', [
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'ping' },
    ]);
    expect(r.body.map((x: { id: number }) => x.id)).toEqual([1, 2]);
  });
});
