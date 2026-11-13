import { describe, expect, it } from 'vitest';
import { anytime, describeWhen, driftingProjects, dumpGroups, expiredDumpSections, isParked, matchContainer, matrix, thisWeek, wakesProject } from './views';
import type { Area, DumpSection, Project, Task } from './types';

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

describe('idle projects', () => {
  const day = '2026-10-14';
  const idle = new Set(['P']);
  const tasks = [
    t('parked', { project_id: 'P' }),
    t('dated', { project_id: 'P', when_date: day }),
    t('due', { project_id: 'P', deadline: '2026-10-30', important: 1 }),
    t('active', { project_id: 'Q' }),
  ];

  it('parks only the undated to-dos of an idle project', () => {
    expect(tasks.filter((x) => isParked(x, idle)).map((x) => x.id)).toEqual(['parked']);
    expect(tasks.filter((x) => isParked(x, new Set())).map((x) => x.id)).toEqual([]);
  });

  it('leaves parked to-dos out of Anytime and the Matrix', () => {
    expect(anytime(tasks, day, new Set(), idle).map((x) => x.id)).toEqual(['dated', 'due', 'active']);
    const m = matrix(tasks, new Set(), idle);
    expect([...m.do, ...m.schedule, ...m.delegate, ...m.drop].map((x) => x.id).sort()).toEqual(['active', 'dated', 'due']);
  });
});

describe('idle drift and wake-up', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-11-06T12:00:00Z');
  const P = (id: string, extra: Partial<Project> = {}): Project => ({ id, area_id: null, name: id, notes: '', sort: 0, completed_at: null, ...extra });

  it('idles active projects with nothing scheduled after 14 quiet days', () => {
    const projects = [P('stale'), P('recent'), P('dated'), P('due'), P('idle', { status: 'idle' }), P('done', { completed_at: '2026-10-01' }), P('unknown')];
    const tasks = [
      t('a', { project_id: 'stale' }),
      t('b', { project_id: 'dated', when_date: '2026-12-01' }),
      t('c', { project_id: 'due', deadline: '2026-12-01' }),
      t('d', { project_id: 'stale', when_date: '2026-10-01', completed_at: '2026-10-01T00:00:00Z' }),
    ];
    const at = new Map(['stale', 'dated', 'due', 'idle', 'done'].map((id) => [id, now - 15 * day]));
    at.set('recent', now - 13 * day);
    expect(driftingProjects(projects, tasks, at, now).map((p) => p.id)).toEqual(['stale']);
  });

  it('wakes on a new date or deadline, or a dated to-do moving in', () => {
    const plain = t('x', { project_id: 'P' });
    expect(wakesProject(plain, { when_date: '2026-11-06' })).toBe(true);
    expect(wakesProject(plain, { deadline: '2026-11-20' })).toBe(true);
    expect(wakesProject(plain, { notes: 'hi' })).toBe(false);
    expect(wakesProject(plain, { someday: 1, when_date: null })).toBe(false);
    const dated = t('y', { when_date: '2026-11-06' });
    expect(wakesProject(dated, { project_id: 'P' })).toBe(true);
    expect(wakesProject(dated, { when_date: '2026-11-06' })).toBe(false);
    expect(wakesProject({ ...dated, completed_at: '2026-11-01T00:00:00Z' }, { project_id: 'P' })).toBe(false);
  });
});

describe('matchContainer', () => {
  const proj = (id: string, name: string, p: Partial<Project> = {}): Project => ({ id, name, area_id: 'home', notes: '', sort: 0, completed_at: null, ...p });
  const areas: Area[] = [{ id: 'home', name: 'Home', sort: 0 }];

  it('prefers the project you are in when names repeat', () => {
    const projects = [proj('old', 'Home Assistant', { completed_at: '2026-01-01' }), proj('a', 'Home Assistant'), proj('b', 'Home Assistant')];
    expect(matchContainer(projects, areas, 'Home Assistant', 'b')).toEqual({ project_id: 'b', area_id: null });
  });

  it('prefers an open project over a completed one of the same name', () => {
    const projects = [proj('old', 'Home Assistant', { completed_at: '2026-01-01' }), proj('new', 'Home Assistant')];
    expect(matchContainer(projects, areas, 'home-assistant')).toEqual({ project_id: 'new', area_id: null });
  });

  it('exact names beat prefixes, projects beat areas, then areas, else null', () => {
    const projects = [proj('long', 'Home Assistant'), proj('short', 'Home')];
    expect(matchContainer(projects, areas, 'Home')).toEqual({ project_id: 'short', area_id: null });
    expect(matchContainer([proj('x', 'Garage')], areas, 'Home')).toEqual({ project_id: null, area_id: 'home' });
    expect(matchContainer([proj('x', 'Garage')], areas, 'Kitchen')).toBeNull();
  });
});
