import { describe, expect, it } from 'vitest';
import { checklistToTask, headingMove, reorderSort, restoreFields, scheduleDropFields } from './dragRules';
import type { Heading, Project, Task } from './types';

const day = '2026-10-28'; // Wednesday
const list = [{ id: 'a', sort: 1 }, { id: 'b', sort: 2 }, { id: 'c', sort: 3 }];

describe('reorderSort (areas, headings, checklist items)', () => {
  it('moves an item before another or to the end', () => {
    expect(reorderSort(list, 'c', 'a')).toBeLessThan(1);
    const s = reorderSort(list, 'a', 'c')!;
    expect(s).toBeGreaterThan(2);
    expect(s).toBeLessThan(3);
    expect(reorderSort(list, 'a', null)).toBeGreaterThan(3);
  });
  it('ignores drops that change nothing or are unknown', () => {
    expect(reorderSort(list, 'b', 'b')).toBeNull();
    expect(reorderSort(list, 'b', 'c')).toBeNull();
    expect(reorderSort(list, 'c', null)).toBeNull();
    expect(reorderSort(list, 'x', 'a')).toBeNull();
    expect(reorderSort(list, 'a', 'x')).toBeNull();
  });
});

describe('headingMove', () => {
  const h: Heading = { id: 'h1', project_id: 'p1', name: 'Phase 1', sort: 5 };
  const headings: Heading[] = [h, { id: 'h2', project_id: 'p2', name: 'Other', sort: 9 }];
  const projects = [
    { id: 'p1', completed_at: null },
    { id: 'p2', completed_at: null },
    { id: 'p3', completed_at: '2026-01-01' },
  ] as Project[];
  it('moves the heading after the target project\'s headings, its to-dos with it', () => {
    expect(headingMove(h, headings, projects, 'p2')).toEqual({ sort: 10, task: { project_id: 'p2', area_id: null, heading_id: 'h1' } });
  });
  it('refuses its own project, unknown or completed ones', () => {
    expect(headingMove(h, headings, projects, 'p1')).toBeNull();
    expect(headingMove(h, headings, projects, 'nope')).toBeNull();
    expect(headingMove(h, headings, projects, 'p3')).toBeNull();
  });
});

describe('checklistToTask', () => {
  const parent = { project_id: 'p1', area_id: null, heading_id: 'h1', when_date: '2026-10-30', evening: 0, someday: 0, sort: 10 } as Task;
  it('on the task list: next to its parent, same project, heading and When', () => {
    expect(checklistToTask({ title: 'Buy nails' }, parent, null, day)).toMatchObject({ title: 'Buy nails', project_id: 'p1', heading_id: 'h1', when_date: '2026-10-30' });
  });
  it('on a sidebar list: that list\'s fields', () => {
    expect(checklistToTask({ title: 'x' }, parent, { kind: 'today' }, day)).toMatchObject({ project_id: 'p1', when_date: day });
    expect(checklistToTask({ title: 'x' }, parent, { kind: 'inbox' }, day)).toMatchObject({ project_id: null, heading_id: null, when_date: null });
    expect(checklistToTask({ title: 'x' }, parent, { kind: 'upcoming' }, day)?.when_date).toBe('2026-10-29');
    expect(checklistToTask({ title: 'x' }, parent, { kind: 'area', id: 'a1' }, day)).toMatchObject({ project_id: null, area_id: 'a1', heading_id: null });
  });
  it('refuses lists that don\'t file to-dos', () => {
    expect(checklistToTask({ title: 'x' }, parent, { kind: 'logbook' }, day)).toBeNull();
    expect(checklistToTask({ title: 'x' }, parent, { kind: 'trash' }, day)).toBeNull();
  });
});

describe('scheduleDropFields (to-dos on Upcoming / This Week)', () => {
  it('Upcoming: tomorrow; This Week: tomorrow, or today on Sunday', () => {
    expect(scheduleDropFields({ completed_at: null }, { kind: 'upcoming' }, day)).toEqual({ when_date: '2026-10-29', evening: 0, someday: 0 });
    expect(scheduleDropFields({ completed_at: null }, { kind: 'week' }, day)?.when_date).toBe('2026-10-29');
    expect(scheduleDropFields({ completed_at: null }, { kind: 'week' }, '2026-11-01')?.when_date).toBe('2026-11-01');
  });
  it('ignores other lists and done to-dos', () => {
    expect(scheduleDropFields({ completed_at: null }, { kind: 'today' }, day)).toBeNull();
    expect(scheduleDropFields({ completed_at: '2026-10-01' }, { kind: 'upcoming' }, day)).toBeNull();
  });
});

describe('restoreFields', () => {
  const done = { completed_at: '2026-10-01', deleted_at: null, dump: 0 };
  const trashed = { completed_at: null, deleted_at: '2026-10-20', dump: 0 };
  it('Logbook → a list: un-completed, with that list\'s state', () => {
    expect(restoreFields(done, 'logbook', { kind: 'today' }, day)).toEqual({ completed_at: null, deleted_at: null, when_date: day, evening: 0, someday: 0 });
    expect(restoreFields(done, 'logbook', { kind: 'project', id: 'p1' }, day)).toMatchObject({ completed_at: null, project_id: 'p1' });
  });
  it('Trash → a list: out of the Trash, with that list\'s state', () => {
    expect(restoreFields(trashed, 'trash', { kind: 'someday' }, day)).toMatchObject({ deleted_at: null, someday: 1 });
    expect(restoreFields({ ...trashed, dump: 1 }, 'trash', { kind: 'inbox' }, day)).toMatchObject({ dump: 0, dump_section_id: null, project_id: null });
  });
  it('ignores rows not in that list, and lists that don\'t file to-dos', () => {
    expect(restoreFields(trashed, 'logbook', { kind: 'today' }, day)).toBeNull();
    expect(restoreFields(done, 'trash', { kind: 'today' }, day)).toBeNull();
    expect(restoreFields(done, 'logbook', { kind: 'trash' }, day)).toBeNull();
    expect(restoreFields(done, 'logbook', { kind: 'dump' }, day)).toBeNull();
  });
});
