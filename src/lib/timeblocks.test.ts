import { describe, expect, it } from 'vitest';
import {
  assignmentError,
  atTime,
  blockColor,
  blockLabel,
  blockSpan,
  clearFrom,
  fitSpan,
  inlineCompletion,
  layoutDay,
  matchOptions,
  nextLevel,
  optionsFor,
  rangeDays,
  shiftSpan,
  sourceBlock,
  sourceMinutes,
  dropSpan,
  splitTime,
  stepAnchor,
} from './timeblocks';
import type { Area, Project, Task, TimeBlock } from './types';

const block = (id: string, start: string, end: string, p: Partial<TimeBlock> = {}): TimeBlock => ({
  id, start_at: start, end_at: end, title: null, area_id: null, project_id: null, task_id: null, calendar_id: null,
  created_at: '2026-10-01T00:00:00Z', deleted_at: null, ...p,
});
const areas: Area[] = [
  { id: 'a-veh', name: 'Vehicles', sort: 0 },
  { id: 'a-fam', name: 'Family', sort: 1 },
  { id: 'a-work', name: 'Work', sort: 2 },
];
const projects = [
  { id: 'p-truck', area_id: 'a-veh', name: 'Truck maintenance', notes: '', sort: 0, completed_at: null },
  { id: 'p-old', area_id: 'a-veh', name: 'Sell old car', notes: '', sort: 1, completed_at: '2026-01-01' },
  { id: 'p-loose', area_id: null, name: 'Loose', notes: '', sort: 2, completed_at: null },
] as Project[];
const tasks = [
  { id: 't-oil', project_id: 'p-truck', title: 'Change oil', sort: 1, completed_at: null, deleted_at: null },
  { id: 't-tires', project_id: 'p-truck', title: 'Rotate tires', sort: 0, completed_at: null, deleted_at: null },
  { id: 't-done', project_id: 'p-truck', title: 'Wash', sort: 2, completed_at: '2026-01-01', deleted_at: null },
] as Task[];

describe('times', () => {
  it('round-trips a local time and midnight as the next day', () => {
    expect(atTime('2026-10-31', 9 * 60 + 15)).toBe('2026-10-31T09:15');
    expect(atTime('2026-10-31', 1440)).toBe('2026-11-01T00:00');
    expect(splitTime('2026-10-31T13:45')).toEqual({ day: '2026-10-31', min: 825 });
  });

  it('reads a block ending at midnight as ending at 24:00', () => {
    expect(blockSpan(block('b', '2026-10-31T22:00', '2026-11-01T00:00'))).toEqual({ day: '2026-10-31', start: 1320, end: 1440 });
  });

  it('snaps, orders and keeps a span within the day', () => {
    expect(fitSpan(9 * 60 + 7, 8 * 60 + 2)).toEqual({ start: 480, end: 540 });
    expect(fitSpan(600, 603)).toEqual({ start: 600, end: 615 });
    expect(fitSpan(1439, 1500)).toEqual({ start: 1425, end: 1440 });
  });

  it('moves a span without changing its length or leaving the day', () => {
    expect(shiftSpan(540, 600, 23)).toEqual({ start: 570, end: 630 });
    expect(shiftSpan(1380, 1440, 60)).toEqual({ start: 1380, end: 1440 });
    expect(shiftSpan(30, 90, -120)).toEqual({ start: 0, end: 60 });
  });
});

describe('ranges', () => {
  it('starts day and 3 days at the anchor, and 7 days and 4 weeks on its Sunday', () => {
    expect(rangeDays('3day', '2026-10-31')).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
    const week = rangeDays('week', '2026-10-28'); // a Wednesday
    expect([week[0], week[6]]).toEqual(['2026-10-25', '2026-10-31']);
    expect(rangeDays('week', '2026-10-25')[0]).toBe('2026-10-25'); // a Sunday stays put
    const four = rangeDays('4week', '2026-10-31'); // a Saturday
    expect(four[0]).toBe('2026-10-25');
    expect(four).toHaveLength(28);
  });

  it('steps by the length of the range', () => {
    expect(stepAnchor('week', '2026-10-31', 1)).toBe('2026-11-07');
    expect(rangeDays('week', stepAnchor('week', '2026-10-28', 1))[0]).toBe('2026-11-01');
    expect(stepAnchor('day', '2026-10-31', -1)).toBe('2026-10-30');
  });
});

describe('layoutDay', () => {
  it('puts overlapping blocks side by side and leaves others full width', () => {
    const out = layoutDay([
      block('a', '2026-10-31T09:00', '2026-10-31T11:00'),
      block('b', '2026-10-31T10:00', '2026-10-31T12:00'),
      block('c', '2026-10-31T11:00', '2026-10-31T11:30'),
      block('d', '2026-10-31T14:00', '2026-10-31T15:00'),
    ]);
    const by = Object.fromEntries(out.map((p) => [p.block.id, [p.lane, p.lanes]]));
    expect(by).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
  });
});

describe('assignment rules', () => {
  it('accepts every level from none down to a to-do', () => {
    expect(assignmentError({ area_id: null, project_id: null, task_id: null }, projects, tasks)).toBeNull();
    expect(assignmentError({ area_id: 'a-veh', project_id: null, task_id: null }, projects, tasks)).toBeNull();
    expect(assignmentError({ area_id: 'a-veh', project_id: 'p-truck', task_id: null }, projects, tasks)).toBeNull();
    expect(assignmentError({ area_id: 'a-veh', project_id: 'p-truck', task_id: 't-oil' }, projects, tasks)).toBeNull();
  });

  it('refuses a level without the one above it, or outside it', () => {
    expect(assignmentError({ area_id: 'a-veh', project_id: null, task_id: 't-oil' }, projects, tasks)).toMatch(/project/);
    expect(assignmentError({ area_id: null, project_id: 'p-truck', task_id: null }, projects, tasks)).toMatch(/area/);
    expect(assignmentError({ area_id: 'a-fam', project_id: 'p-truck', task_id: null }, projects, tasks)).toMatch(/not in this area/);
    expect(assignmentError({ area_id: 'a-veh', project_id: 'p-truck', task_id: 'nope' }, projects, tasks)).toMatch(/not in this project/);
  });

  it('steps down one level at a time, and back up clears what is below', () => {
    const full = { area_id: 'a-veh', project_id: 'p-truck', task_id: 't-oil' };
    expect(nextLevel({ area_id: null, project_id: null, task_id: null })).toBe('area');
    expect(nextLevel({ ...full, task_id: null, project_id: null })).toBe('project');
    expect(nextLevel(full)).toBeNull();
    expect(clearFrom(full, 'project')).toEqual({ area_id: 'a-veh', project_id: null, task_id: null });
  });

  it('suggests open projects in the area, then open to-dos in sidebar order', () => {
    const a = { area_id: 'a-veh', project_id: 'p-truck', task_id: null };
    expect(optionsFor('project', a, areas, projects, tasks).map((o) => o.id)).toEqual(['p-truck']);
    expect(optionsFor('task', a, areas, projects, tasks).map((o) => o.id)).toEqual(['t-tires', 't-oil']);
  });
});

describe('autocomplete', () => {
  const opts = areas.map((a) => ({ id: a.id, name: a.name }));

  it('matches a prefix ignoring case', () => {
    expect(matchOptions(opts, 'VEH').map((o) => o.id)).toEqual(['a-veh']);
    expect(inlineCompletion('Vehicles', 'VEH')).toBe('icles');
  });

  it('ranks name prefixes over word prefixes over substrings', () => {
    const o = [
      { id: '1', name: 'Home office' },
      { id: '2', name: 'Office' },
      { id: '3', name: 'Back office' },
      { id: '4', name: 'Ofsted' },
    ];
    expect(matchOptions(o, 'off').map((x) => x.id)).toEqual(['2', '1', '3']);
    expect(matchOptions(o, 'ffi').map((x) => x.id)).toEqual(['1', '2', '3']);
  });

  it('lists everything for an empty query and shows no completion for a non-prefix', () => {
    expect(matchOptions(opts, '  ')).toHaveLength(3);
    expect(inlineCompletion('Home office', 'off')).toBe('');
  });
});

describe('display', () => {
  it('titles a block by its deepest level with the rest as a breadcrumb', () => {
    const b = block('b', '2026-10-31T09:00', '2026-10-31T10:00', { area_id: 'a-veh', project_id: 'p-truck', task_id: 't-oil' });
    expect(blockLabel(b, areas, projects, tasks)).toEqual({ title: 'Change oil', crumbs: ['Vehicles', 'Truck maintenance'] });
    expect(blockLabel(block('g', 'x', 'y', { title: 'Taxes' }), areas, projects, tasks)).toEqual({ title: 'Taxes', crumbs: [] });
  });

  it('colors by area and grays unassigned blocks', () => {
    expect(blockColor('a-fam', areas)).toBe('var(--anytime)');
    expect(blockColor(null, areas)).toBe('var(--text-3)');
  });
});

describe('dropping on the calendar', () => {
  const ts = [
    ...tasks,
    { id: 't-inbox', project_id: null, area_id: null, title: 'Call dentist', estimate_min: 20 },
    { id: 't-area', project_id: null, area_id: 'a-fam', title: 'Plan party', estimate_min: null },
    { id: 't-loose', project_id: 'p-loose', area_id: null, title: 'Loose thing' },
  ] as Task[];

  it('links an area, a project in an area, and a to-do in such a project', () => {
    expect(sourceBlock({ kind: 'area', id: 'a-veh' }, areas, projects, ts)?.assignment).toEqual({ area_id: 'a-veh', project_id: null, task_id: null });
    expect(sourceBlock({ kind: 'project', id: 'p-truck' }, areas, projects, ts)?.assignment).toEqual({ area_id: 'a-veh', project_id: 'p-truck', task_id: null });
    expect(sourceBlock({ kind: 'task', id: 't-oil' }, areas, projects, ts)).toEqual({ assignment: { area_id: 'a-veh', project_id: 'p-truck', task_id: 't-oil' }, title: null, label: 'Change oil' });
  });

  it('keeps the name of what the rules cannot link', () => {
    const none = { area_id: null, project_id: null, task_id: null };
    expect(sourceBlock({ kind: 'project', id: 'p-loose' }, areas, projects, ts)).toMatchObject({ assignment: none, title: 'Loose' });
    expect(sourceBlock({ kind: 'task', id: 't-inbox' }, areas, projects, ts)).toMatchObject({ assignment: none, title: 'Call dentist' });
    expect(sourceBlock({ kind: 'task', id: 't-loose' }, areas, projects, ts)).toMatchObject({ assignment: none, title: 'Loose thing' });
    expect(sourceBlock({ kind: 'task', id: 't-area' }, areas, projects, ts)).toMatchObject({ assignment: { ...none, area_id: 'a-fam' }, title: 'Plan party' });
    expect(sourceBlock({ kind: 'area', id: 'gone' }, areas, projects, ts)).toBeNull();
  });

  it('shows a named block in an area under that area', () => {
    const b = block('b', '2026-10-31T09:00', '2026-10-31T10:00', { area_id: 'a-fam', title: 'Plan party' });
    expect(blockLabel(b, areas, projects, ts)).toEqual({ title: 'Plan party', crumbs: ['Family'] });
  });

  it('sizes a block by the estimate and lands it in the slot under the pointer', () => {
    expect(sourceMinutes({ kind: 'task', id: 't-inbox' }, ts)).toBe(30);
    expect(sourceMinutes({ kind: 'task', id: 't-area' }, ts)).toBe(60);
    expect(sourceMinutes({ kind: 'area', id: 'a-veh' }, ts)).toBe(60);
    expect(dropSpan(9 * 60 + 40, 60)).toEqual({ start: 570, end: 630 });
    expect(dropSpan(23 * 60 + 50, 60)).toEqual({ start: 1380, end: 1440 });
  });
});
