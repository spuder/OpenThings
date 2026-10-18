import { describe, expect, it } from 'vitest';
import { nextOccurrence, parseQuickAdd } from './parse';
import { dump, inbox, isDumpExpired, matrix, streak, todayView, upcoming } from './views';
import type { Task } from './types';

// 2026-10-18 is a Sunday.
const REF = '2026-10-18';

describe('parseQuickAdd', () => {
  it('extracts tags, project, when, deadline, estimate', () => {
    const p = parseQuickAdd('Print dino stands #printing #shop +Jurassic-Stacks @tomorrow !fri ~1h30m', REF);
    expect(p.title).toBe('Print dino stands');
    expect(p.tags).toEqual(['printing', 'shop']);
    expect(p.project).toBe('Jurassic Stacks');
    expect(p.when?.date).toBe('2026-10-19');
    expect(p.deadline).toBe('2026-10-23');
    expect(p.estimateMin).toBe(90);
  });

  it('keeps #1 style issue numbers in the title', () => {
    const p = parseQuickAdd('Fix bug #12 #work', REF);
    expect(p.title).toBe('Fix bug #12');
    expect(p.tags).toEqual(['work']);
  });

  it('handles evening, someday, inbox', () => {
    expect(parseQuickAdd('Read @tonight', REF).when).toEqual({ date: REF, evening: true, someday: false, inbox: false });
    expect(parseQuickAdd('Learn piano @someday', REF).when?.someday).toBe(true);
    expect(parseQuickAdd('Thing @inbox', REF).when?.inbox).toBe(true);
  });

  it('parses relative and ISO dates', () => {
    expect(parseQuickAdd('a @in3d', REF).when?.date).toBe('2026-10-21');
    expect(parseQuickAdd('a @2w', REF).when?.date).toBe('2026-11-01');
    expect(parseQuickAdd('a @2026-12-01', REF).when?.date).toBe('2026-12-01');
    expect(parseQuickAdd('a @next-week', REF).when?.date).toBe('2026-10-19');
    expect(parseQuickAdd('a @mon', REF).when?.date).toBe('2026-10-19');
    expect(parseQuickAdd('a @nov-3', REF).when?.date).toBe('2026-11-03');
  });

  it('brain dump with section', () => {
    const p = parseQuickAdd('call plumber @dump/Home', REF);
    expect(p.dump).toBe(true);
    expect(p.dumpSection).toBe('Home');
    expect(p.title).toBe('call plumber');
  });

  it('repeat implies a start date, matrix flags, notes', () => {
    const p = parseQuickAdd('Standup *weekdays ^ui // bring notes', REF);
    expect(p.rrule).toContain('BYDAY=MO,TU,WE,TH,FR');
    expect(p.when?.date).toBe(REF);
    expect(p.urgent && p.important).toBe(true);
    expect(p.notes).toBe('bring notes');
    expect(p.title).toBe('Standup');
  });

  it('leaves unknown @words in the title with a warning', () => {
    const p = parseQuickAdd('email bob @blarg', REF);
    expect(p.title).toBe('email bob @blarg');
    expect(p.warnings.length).toBe(1);
  });
});

describe('nextOccurrence', () => {
  it('skips weekends for weekdays', () => {
    expect(nextOccurrence('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '2026-10-23')).toBe('2026-10-26');
  });
  it('handles intervals', () => {
    expect(nextOccurrence('FREQ=DAILY;INTERVAL=3', REF)).toBe('2026-10-21');
    expect(nextOccurrence('FREQ=MONTHLY;INTERVAL=1', REF)).toBe('2026-11-18');
  });
});

function task(p: Partial<Task>): Task {
  return {
    id: Math.random().toString(36).slice(2),
    title: 't',
    notes: '',
    project_id: null,
    area_id: null,
    heading_id: null,
    when_date: null,
    evening: 0,
    someday: 0,
    deadline: null,
    completed_at: null,
    created_at: '2026-10-18T10:00:00.000Z',
    sort: 0,
    urgent: 0,
    important: 0,
    estimate_min: null,
    rrule: null,
    dump: 0,
    dump_section_id: null,
    ...p,
  };
}

describe('views', () => {
  const none = new Set<string>();
  it('inbox excludes scheduled, project, dump', () => {
    const ts = [task({}), task({ when_date: REF }), task({ project_id: 'p' }), task({ dump: 1 })];
    expect(inbox(ts, none)).toHaveLength(1);
  });
  it('today includes overdue and deadlines, splits evening', () => {
    const ts = [task({ when_date: '2026-10-10' }), task({ deadline: REF }), task({ when_date: REF, evening: 1 }), task({ when_date: '2026-10-20' })];
    const v = todayView(ts, REF, none);
    expect(v.day).toHaveLength(2);
    expect(v.evening).toHaveLength(1);
  });
  it('upcoming groups by date', () => {
    const ts = [task({ when_date: '2026-10-20' }), task({ when_date: '2026-10-20' }), task({ when_date: '2026-10-25' })];
    expect(upcoming(ts, REF, none).map((g) => g.tasks.length)).toEqual([2, 1]);
  });
  it('dump expires unchecked items after 48h but keeps checked ones out of the list', () => {
    const now = Date.parse('2026-10-20T11:00:00.000Z');
    const old = task({ dump: 1, created_at: '2026-10-18T10:00:00.000Z' });
    const fresh = task({ dump: 1, created_at: '2026-10-20T10:00:00.000Z' });
    expect(isDumpExpired(old, now)).toBe(true);
    expect(dump([old, fresh], none, now)).toEqual([fresh]);
  });
  it('matrix quadrants', () => {
    const m = matrix([task({ urgent: 1, important: 1 }), task({ important: 1 }), task({})], none);
    expect([m.do.length, m.schedule.length, m.delegate.length, m.drop.length]).toEqual([1, 1, 0, 1]);
  });
  it('streak counts back from today or yesterday', () => {
    expect(streak(new Set(['2026-10-16', '2026-10-17', '2026-10-18']), REF)).toBe(3);
    expect(streak(new Set(['2026-10-16', '2026-10-17']), REF)).toBe(2);
    expect(streak(new Set(['2026-10-15']), REF)).toBe(0);
  });
});
