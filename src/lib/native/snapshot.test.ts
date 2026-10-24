import { describe, expect, it } from 'vitest';
import type { SyncState } from '../sync/protocol';
import type { Task } from '../types';
import { addLinkParsed, addLinkPrefill, buildSnapshot, notificationId, parseRoute, pendingToParsed, type PendingItem } from './snapshot';

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
    expect(parseRoute('openthings://add?text=Milk%20%23shop')).toMatchObject({ kind: 'add', text: 'Milk #shop', title: '', save: false });
    expect(parseRoute('openthings://logbook')).toEqual({ kind: 'view', view: 'logbook' });
    expect(parseRoute('https://example.com')).toBeNull();
    expect(parseRoute('openthings://nope')).toBeNull();
  });

  it('takes three slashes, as Automator and other apps write links', () => {
    expect(parseRoute('openthings:///today')).toEqual({ kind: 'view', view: 'today' });
    expect(parseRoute('openthings:///task/abc-123')).toEqual({ kind: 'task', id: 'abc-123' });
    expect(parseRoute('openthings:///add?title=Milk')).toMatchObject({ kind: 'add', title: 'Milk' });
    expect(parseRoute('openthings:///pair?server=https%3A%2F%2Fot.example.ts.net')).toEqual({ kind: 'pair', server: 'https://ot.example.ts.net' });
  });

  it('reads the fields of an add link', () => {
    expect(parseRoute('openthings://add?title=Call%20%23Bob&notes=Line%201%0ALine%202&when=next%20week&deadline=fri&tags=errand,%20work&tags=home&list=Garage&save=1')).toEqual({
      kind: 'add',
      text: '',
      title: 'Call #Bob',
      notes: 'Line 1\nLine 2',
      when: 'next week',
      deadline: 'fri',
      tags: ['errand', 'work', 'home'],
      list: 'Garage',
      dump: false,
      save: true,
    });
    expect(parseRoute('openthings://add?title=x&save=true')).toMatchObject({ save: true });
    expect(parseRoute('openthings://add?title=x&save=0')).toMatchObject({ save: false });
  });

  it('reads pairing links from the QR code in Settings', () => {
    expect(parseRoute('openthings://pair?server=https%3A%2F%2Fot.example.ts.net')).toEqual({ kind: 'pair', server: 'https://ot.example.ts.net' });
    expect(parseRoute('openthings://pair?server=')).toBeNull();
  });
});

describe('add links', () => {
  const day = '2026-10-21'; // a Wednesday
  const link = (q: string) => {
    const r = parseRoute(`openthings://add?${q}`);
    if (r?.kind !== 'add') throw new Error('not an add link');
    return r;
  };

  it('keeps literal fields literal', () => {
    const p = addLinkParsed(link('title=Fix%20bug%20%2312%20@today&notes=see%20%23log'), day);
    expect(p.title).toBe('Fix bug #12 @today');
    expect(p.notes).toBe('see #log');
    expect(p.tags).toEqual([]);
    expect(p.when).toBeNull();
  });

  it('parses when, deadline, tags and list', () => {
    const p = addLinkParsed(link('title=Paint&when=tomorrow&deadline=2026-11-02&tags=home,Weekend&list=Garage%20cleanup'), day);
    expect(p.when).toEqual({ date: '2026-10-22', evening: false, someday: false, inbox: false });
    expect(p.deadline).toBe('2026-11-02');
    expect(p.tags).toEqual(['home', 'Weekend']);
    expect(p.project).toBe('Garage cleanup');
    expect(addLinkParsed(link('title=a&when=someday'), day).when?.someday).toBe(true);
    expect(addLinkParsed(link('title=a&when=evening'), day).when).toMatchObject({ date: day, evening: true });
    expect(addLinkParsed(link('title=a&when=next%20week'), day).when?.date).toBe('2026-10-26');
  });

  it('parses text as quick add, then lets fields override it', () => {
    const p = addLinkParsed(link('text=Milk%20%23shop%20@fri&tags=shop,dairy&when=today'), day);
    expect(p.title).toBe('Milk');
    expect(p.tags).toEqual(['shop', 'dairy']);
    expect(p.when?.date).toBe(day);
  });

  it('sends dump=1 links to the brain dump, unless when or list places them elsewhere', () => {
    expect(parseRoute('openthings://add?dump=1')).toMatchObject({ dump: true });
    expect(addLinkParsed(link('title=idea&dump=1'), day).dump).toBe(true);
    expect(addLinkParsed(link('title=idea&dump=1&when=today'), day).dump).toBe(false);
    expect(addLinkParsed(link('title=idea&dump=1&list=Garage'), day).dump).toBe(false);
  });

  it('prefills quick add for the widgets, with room to type after the token', () => {
    expect(addLinkPrefill(link('when=inbox'))).toBe('@inbox ');
    expect(addLinkPrefill(link('dump=1'))).toBe('@dump ');
    expect(addLinkPrefill(link(''))).toBe('');
    expect(addLinkPrefill(link('title=Milk&notes=2%25'))).toBe('Milk // 2%');
  });

  it('warns about dates it does not understand', () => {
    const p = addLinkParsed(link('title=a&when=blursday&deadline=never'), day);
    expect(p.when).toBeNull();
    expect(p.deadline).toBeNull();
    expect(p.warnings).toEqual(['Unknown when: blursday', 'Unknown deadline: never']);
  });

  it('turns fields into quick-add text to review', () => {
    expect(addLinkPrefill(link('text=Milk%20%23shop'))).toBe('Milk #shop');
    expect(addLinkPrefill(link('title=Paint%20shed&tags=home,big%20job&list=Garage%20cleanup&when=next%20week&deadline=fri&notes=Two%20coats'))).toBe(
      'Paint shed #home #big-job +Garage-cleanup @next-week !fri // Two coats',
    );
  });
});
