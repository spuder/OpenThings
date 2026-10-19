import { describe, expect, it } from 'vitest';
import { describeWhen, thisWeek } from './views';
import type { Task } from './types';

const base = {
  notes: '', project_id: null, area_id: null, heading_id: null, someday: 0, evening: 0, dump: 0, dump_section_id: null,
  deadline: null, when_date: null, completed_at: null, deleted_at: null, sort: 0, created_at: '2026-10-01T00:00:00Z',
} as unknown as Task;
const t = (id: string, p: Partial<Task>): Task => ({ ...base, id, title: id, ...p }) as Task;

describe('thisWeek', () => {
  // 2026-10-14 is a Wednesday; the week runs Mon 10-12 .. Sun 10-18.
  const day = '2026-10-14';
  const tasks = [
    t('overdue', { when_date: '2026-10-10' }),
    t('today', { when_date: day }),
    t('fri', { when_date: '2026-10-16' }),
    t('sun-deadline', { deadline: '2026-10-18' }),
    t('next-mon', { when_date: '2026-10-19' }),
    t('early-deadline', { when_date: '2026-10-25', deadline: '2026-10-17' }),
    t('someday', { when_date: '2026-10-15', someday: 1 }),
    t('dump', { when_date: '2026-10-15', dump: 1 }),
    t('done', { when_date: '2026-10-15', completed_at: '2026-10-13T00:00:00Z' }),
    t('unscheduled', {}),
  ];
  const g = thisWeek(tasks, day, new Set());
  const ids = (d: string) => g.find((x) => x.date === d)?.tasks.map((x) => x.id) ?? [];

  it('groups by day through Sunday, folding overdue into today', () => {
    expect(g.map((x) => x.date)).toEqual(['2026-10-14', '2026-10-16', '2026-10-17', '2026-10-18']);
    expect(ids(day).sort()).toEqual(['overdue', 'today']);
    expect(ids('2026-10-16')).toEqual(['fri']);
    expect(ids('2026-10-18')).toEqual(['sun-deadline']);
  });

  it('uses the earlier of When and Deadline', () => {
    expect(ids('2026-10-17')).toEqual(['early-deadline']);
  });

  it('skips next week, someday, dump, done and unscheduled', () => {
    const all = g.flatMap((x) => x.tasks.map((y) => y.id));
    for (const id of ['next-mon', 'someday', 'dump', 'done', 'unscheduled']) expect(all).not.toContain(id);
  });

  it('on Sunday shows only today', () => {
    expect(thisWeek(tasks, '2026-10-18', new Set()).map((x) => x.date)).toEqual(['2026-10-18']);
  });
});

describe('describeWhen', () => {
  const day = '2026-10-14'; // a Wednesday
  it('names the list the to-do moved to', () => {
    expect(describeWhen(t('a', { when_date: day }), day)).toBe('Moved to Today');
    expect(describeWhen(t('a', { when_date: day, evening: 1 }), day)).toBe('Moved to This Evening');
    expect(describeWhen(t('a', { someday: 1 }), day)).toBe('Moved to Someday');
    expect(describeWhen(t('a', { project_id: 'p' }), day)).toBe('Moved to Anytime');
    expect(describeWhen(t('a', {}), day)).toBe('Moved to Inbox');
  });
  it('includes the day for future dates', () => {
    expect(describeWhen(t('a', { when_date: '2026-10-15' }), day)).toBe('Moved to Upcoming · Tomorrow');
    expect(describeWhen(t('a', { when_date: '2026-10-16' }), day)).toBe('Moved to Upcoming · Friday');
    expect(describeWhen(t('a', { when_date: '2026-11-02' }), day)).toBe('Moved to Upcoming · Nov 2');
  });
});
