import { describe, expect, it } from 'vitest';
import type { SyncState } from '../sync/protocol';
import type { Task } from '../types';
import { buildSnapshot, notificationId, parseRoute, pendingToParsed, type PendingItem } from './snapshot';

function task(p: Partial<Task>): Task {
  return {
    id: 't',
    title: 'Task',
    notes: '',
    project_id: null,
    area_id: null,
    heading_id: null,
    when_date: null,
    evening: 0,
    someday: 0,
    deadline: null,
    completed_at: null,
    created_at: '2026-10-18T08:00:00.000Z',
    sort: 1,
    urgent: 0,
    important: 0,
    estimate_min: null,
    rrule: null,
    dump: 0,
    dump_section_id: null,
    deleted_at: null,
    reminder_at: null,
    reminder_sent_at: null,
    ...p,
  };
}

const syncState: SyncState = { status: 'local', enabled: false, serverUrl: null, device: 'd', pending: 0, lastSyncedAt: null, error: null };

describe('buildSnapshot', () => {
  it('lists Today and This Evening with container names and counts', () => {
    const tasks = [
      task({ id: 'a', title: 'Morning', when_date: '2026-10-18', sort: 1, project_id: 'p1' }),
      task({ id: 'b', title: 'Evening', when_date: '2026-10-18', evening: 1, sort: 2 }),
      task({ id: 'c', title: 'Inbox thing', sort: 3 }),
      task({ id: 'd', title: 'Done', when_date: '2026-10-18', completed_at: '2026-10-18T09:00:00Z' }),
      task({ id: 'e', title: 'Later', when_date: '2026-10-25' }),
    ];
    const s = buildSnapshot({
      tasks,
      projects: [{ id: 'p1', area_id: null, name: 'Launch', notes: '', sort: 1, completed_at: null }],
      areas: [],
      day: '2026-10-18',
      now: Date.parse('2026-10-18T10:00:00Z'),
      reminders: [],
      sync: syncState,
    });
    expect(s.today.map((t) => t.id)).toEqual(['a', 'b']);
    expect(s.today[0].container).toBe('Launch');
    expect(s.today[1].evening).toBe(true);
    expect(s.counts).toEqual({ today: 1, evening: 1, inbox: 1, dump: 0 });
    expect(s.sync.status).toBe('local');
    expect(s).not.toHaveProperty('sync.device');
  });
});

describe('notificationId', () => {
  it('is a stable positive 31-bit integer', () => {
    const id = notificationId('0192c0de-aaaa-7bbb-8ccc-0123456789ab');
    expect(id).toBe(notificationId('0192c0de-aaaa-7bbb-8ccc-0123456789ab'));
    expect(id).toBeGreaterThan(0);
    expect(id).toBeLessThan(2 ** 31);
    expect(notificationId('x')).not.toBe(notificationId('y'));
  });
});

describe('pendingToParsed', () => {
  const base: PendingItem = { id: '1', text: '', parse: false, target: 'inbox', source: 'share', createdAt: '2026-10-18T10:00:00Z' };

  it('keeps shared text literal and puts extra lines and the URL in notes', () => {
    const p = pendingToParsed({ ...base, text: 'Read #this @later', notes: 'https://example.com/a#b' }, '2026-10-18')!;
    expect(p.title).toBe('Read #this @later');
    expect(p.tags).toEqual([]);
    expect(p.when).toBeNull();
    expect(p.notes).toBe('https://example.com/a#b');
  });

  it('uses the URL as the title when there is no text', () => {
    const p = pendingToParsed({ ...base, text: '', notes: 'https://example.com' }, '2026-10-18')!;
    expect(p.title).toBe('https://example.com');
  });

  it('parses quick-add syntax from Shortcuts', () => {
    const p = pendingToParsed({ ...base, text: 'Call dentist @tomorrow #phone', parse: true }, '2026-10-18')!;
    expect(p.title).toBe('Call dentist');
    expect(p.when?.date).toBe('2026-10-19');
    expect(p.tags).toEqual(['phone']);
  });

  it('sends to the brain dump when asked, unless the text places it elsewhere', () => {
    expect(pendingToParsed({ ...base, text: 'idea', target: 'dump' }, '2026-10-18')!.dump).toBe(true);
    expect(pendingToParsed({ ...base, text: 'idea @today', parse: true, target: 'dump' }, '2026-10-18')!.dump).toBe(false);
  });

  it('drops empty items', () => {
    expect(pendingToParsed({ ...base, text: '   ' }, '2026-10-18')).toBeNull();
  });
});

describe('parseRoute', () => {
  it('reads widget and Shortcut links', () => {
    expect(parseRoute('openthings://today')).toEqual({ kind: 'view', view: 'today' });
    expect(parseRoute('openthings://task/abc-123')).toEqual({ kind: 'task', id: 'abc-123' });
    expect(parseRoute('openthings://add?text=Milk%20%23shop')).toEqual({ kind: 'add', text: 'Milk #shop' });
    expect(parseRoute('https://example.com')).toBeNull();
    expect(parseRoute('openthings://nope')).toBeNull();
  });
});
