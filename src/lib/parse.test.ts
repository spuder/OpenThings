import { describe, expect, it } from 'vitest';
import { nextOccurrence, parseQuickAdd, parseReminder } from './parse';
import { challengeProgress, describeSchedule, dump, habitStreak, parseSchedule, inbox, isDumpExpired, matrix, streak, todayView, upcoming } from './views';
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
    deleted_at: null,
    reminder_at: null,
    reminder_sent_at: null,
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

describe('challengeProgress', () => {
  it('counts done and missed days within the window', () => {
    const p = challengeProgress('2026-10-10', 75, new Set(['2026-10-10', '2026-10-11', '2026-10-13', '2026-10-18']), REF);
    expect(p.day).toBe(9);
    expect(p.done).toBe(4);
    expect(p.missed).toBe(5); // 12, 14, 15, 16, 17
    expect(p.end).toBe('2026-12-23');
    expect(p.finished).toBe(false);
  });
  it('finishes after the end date', () => {
    const p = challengeProgress('2026-09-01', 30, new Set(), REF);
    expect(p.finished).toBe(true);
    expect(p.day).toBe(30);
    expect(p.missed).toBe(30);
  });
});

describe('reminders', () => {
  // Sunday 2026-10-18, 15:00 local.
  const now = new Date(2026, 9, 18, 15, 0, 0);
  const local = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  it('bare times land today, or tomorrow if already past', () => {
    expect(local(parseReminder('6pm', REF, now)!)).toBe('2026-10-18 18:00');
    expect(local(parseReminder('9am', REF, now)!)).toBe('2026-10-19 09:00');
    expect(local(parseReminder('18:30', REF, now)!)).toBe('2026-10-18 18:30');
  });
  it('bare times use the scheduled day when there is one', () => {
    const p = parseQuickAdd('Call bank @fri %9:30am', REF, now);
    expect(p.title).toBe('Call bank');
    expect(local(p.reminderAt!)).toBe('2026-10-23 09:30');
  });
  it('relative and day+time', () => {
    expect(local(parseReminder('in30m', REF, now)!)).toBe('2026-10-18 15:30');
    expect(local(parseReminder('in-2h', REF, now)!)).toBe('2026-10-18 17:00');
    expect(local(parseReminder('tomorrow-8am', REF, now)!)).toBe('2026-10-19 08:00');
    expect(local(parseReminder('friday', REF, now)!)).toBe('2026-10-23 09:00');
  });
  it('rejects nonsense and keeps it in the title', () => {
    expect(parseReminder('25:00', REF, now)).toBeNull();
    const p = parseQuickAdd('Odd %blorp', REF, now);
    expect(p.reminderAt).toBeNull();
    expect(p.title).toBe('Odd %blorp');
  });
});

describe('habit schedules', () => {
  const set = (...d: string[]) => new Set(d);
  it('parses and describes', () => {
    expect(describeSchedule(parseSchedule('days:1,2,3,4,5'))).toBe('Weekdays');
    expect(describeSchedule(parseSchedule('times:5'))).toBe('5× a week');
    expect(describeSchedule(parseSchedule('days:0,1,3'))).toBe('Mon Wed Sun');
    expect(parseSchedule('times:7').kind).toBe('daily');
    expect(parseSchedule('garbage').kind).toBe('daily');
  });
  it('weekday streaks skip weekends', () => {
    const d = set('2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16');
    expect(habitStreak(parseSchedule('days:1,2,3,4,5'), d, REF)).toEqual({ value: 5, unit: 'day' });
    // The same check-ins as a daily habit: Saturday breaks it.
    expect(habitStreak(parseSchedule('daily'), d, REF).value).toBe(0);
  });
  it('N-times-a-week streaks count weeks', () => {
    const d = set('2026-10-06', '2026-10-08', '2026-10-13', '2026-10-14', '2026-10-15');
    expect(habitStreak(parseSchedule('times:3'), d, REF)).toEqual({ value: 1, unit: 'week' });
    expect(habitStreak(parseSchedule('times:2'), d, REF)).toEqual({ value: 2, unit: 'week' });
  });
  it('challenges only count due days as missed', () => {
    const d = set('2026-10-05', '2026-10-06', '2026-10-07');
    const p = challengeProgress('2026-10-05', 14, d, REF, parseSchedule('days:1,2,3,4,5'));
    expect(p.required).toBe(10);
    expect(p.done).toBe(3);
    expect(p.missed).toBe(7); // Oct 8, 9, 12, 13, 14, 15, 16
  });
});
