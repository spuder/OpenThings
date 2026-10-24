import { describe, expect, it } from 'vitest';
import { describeWhen, dumpGroups, expiredDumpSections, thisWeek } from './views';
import type { DumpSection, Task } from './types';

const base = {
  notes: '', project_id: null, area_id: null, heading_id: null, someday: 0, evening: 0, dump: 0, dump_section_id: null,
  deadline: null, when_date: null, completed_at: null, deleted_at: null, sort: 0, created_at: '2026-10-01T00:00:00Z',
} as unknown as Task;
const t = (id: string, p: Partial<Task>): Task => ({ ...base, id, title: id, ...p }) as Task;

describe('dumpGroups', () => {
  const sections: DumpSection[] = [
    { id: 'unused', name: 'Unused', sort: 0 },
    { id: 'active', name: 'Active', sort: 1 },
  ];
  const ids = (ts: Task[]) => ts.map((x) => x.id);

  it('keeps every section, including empty ones', () => {
    const g = dumpGroups(sections, [t('a', { dump: 1, dump_section_id: 'active' })]);
    expect(g.sections.map((s) => [s.section.id, ids(s.items)])).toEqual([['unused', []], ['active', ['a']]]);
  });

  it('lists tasks whose section was removed as unsectioned', () => {
    const items = [t('loose', { dump: 1 }), t('orphan', { dump: 1, dump_section_id: 'removed' }), t('kept', { dump: 1, dump_section_id: 'active' })];

    const g = dumpGroups(sections, items);
    expect(ids(g.loose)).toEqual(['loose', 'orphan']);
    expect(g.sections.flatMap((s) => ids(s.items))).toEqual(['kept']);
  });
});

describe('expiredDumpSections', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
  const s = (id: string): DumpSection => ({ id, name: id, sort: 0 });
  const gone = (tasks: Task[], justExpired: string[] = []) =>
    expiredDumpSections([s('x')], tasks, new Set(justExpired), now).map((x) => x.id);

  it('removes a section when its last to-do just expired', () => {
    expect(gone([], ['x'])).toEqual(['x']);
  });

  it('keeps a section that never had a to-do', () => {
    expect(gone([])).toEqual([]);
  });

  it('keeps a section with an open to-do', () => {
    expect(gone([t('a', { dump: 1, dump_section_id: 'x', created_at: hoursAgo(1) })], ['x'])).toEqual([]);
  });

  it('keeps a section whose deleted to-do has not reached 48h yet', () => {
    expect(gone([t('a', { dump: 1, dump_section_id: 'x', created_at: hoursAgo(10), deleted_at: hoursAgo(1) })])).toEqual([]);
  });

  it('removes it once the deleted or checked to-dos would have expired', () => {
    const tasks = [
      t('trashed', { dump: 1, dump_section_id: 'x', created_at: hoursAgo(49), deleted_at: hoursAgo(40) }),
      t('checked', { dump: 1, dump_section_id: 'x', created_at: hoursAgo(50), completed_at: hoursAgo(45) }),
    ];
    expect(gone(tasks)).toEqual(['x']);
  });
});

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
