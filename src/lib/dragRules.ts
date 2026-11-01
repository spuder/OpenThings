/**
 * Drop rules for the drags added after #132: areas and headings reordered, a heading moved to
 * another project, checklist items reordered or pulled out into to-dos, to-dos dropped on
 * Upcoming/This Week, and to-dos restored from the Logbook or Trash. Pure, so the store and the
 * tests share them. Every function returns null for a drop that is invalid or would change nothing.
 */
import { listDropFields, DUMP_DROP_KINDS } from './dumpDrop';
import { moveBlock } from './selection';
import type { ChecklistItem, Heading, ID, Project, Task, ViewKey } from './types';

/**
 * The new sort key for item `id` dropped just before `before` (null: at the end) in `list`
 * (already in display order). Null when either isn't in the list or it would land where it is.
 */
export function reorderSort<T extends { id: ID; sort: number }>(list: T[], id: ID, before: ID | null): number | null {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0 || (before !== null && !list.some((x) => x.id === before))) return null;
  if (before === id || before === (list[i + 1]?.id ?? null)) return null;
  const placed = moveBlock(list, [id], before).find((x) => x.id === id);
  return placed ? placed.sort : null;
}

/** Sidebar lists a to-do can be filed in by a drop that schedules or files it (same set as Brain Dump). */
export const FILE_KINDS = DUMP_DROP_KINDS;

/**
 * A to-do dropped on Upcoming or This Week in the sidebar: scheduled tomorrow (This Week: tomorrow,
 * or today on Sunday), the same rule as Brain Dump drops. Null for other lists and done to-dos.
 */
export function scheduleDropFields(t: Pick<Task, 'completed_at'>, v: ViewKey, day: string): Partial<Task> | null {
  if (t.completed_at || (v.kind !== 'upcoming' && v.kind !== 'week')) return null;
  return listDropFields(v, day);
}

/**
 * Moving heading `h` (with its to-dos) to project `target`: the heading's new sort (after the
 * target's headings) and the fields for each of its to-dos. Null for the same project or an
 * unknown or completed target.
 */
export function headingMove(
  h: Heading,
  headings: Heading[],
  projects: Project[],
  target: ID,
): { sort: number; task: Partial<Task> } | null {
  if (h.project_id === target) return null;
  const p = projects.find((x) => x.id === target);
  if (!p || p.completed_at) return null;
  const last = Math.max(h.sort, ...headings.filter((x) => x.project_id === target).map((x) => x.sort));
  return { sort: last + 1, task: { project_id: target, area_id: null, heading_id: h.id } };
}

/**
 * A checklist item pulled out of to-do `parent` becomes its own to-do. Dropped on the task list
 * (`v` null): next to its parent, in the same project, heading and When. Dropped on a sidebar list:
 * the parent's project and heading, then that list's fields (Inbox clears them, a project or area
 * replaces them). Null for a list it can't go to.
 */
export function checklistToTask(
  c: Pick<ChecklistItem, 'title'>,
  parent: Task,
  v: ViewKey | null,
  day: string,
): Partial<Task> | null {
  const base: Partial<Task> = {
    title: c.title,
    project_id: parent.project_id,
    area_id: parent.area_id,
    heading_id: parent.heading_id,
    when_date: parent.when_date,
    evening: parent.evening,
    someday: parent.someday,
    sort: parent.sort + 0.0001,
  };
  if (!v) return base;
  if (!FILE_KINDS.includes(v.kind)) return null;
  const f = listDropFields(v, day);
  return f && { ...base, ...f };
}

/**
 * A to-do dragged out of the Logbook or Trash onto a sidebar list: back to open (un-completed and
 * out of the Trash) with that list's fields. Null when it isn't in `from` or the list can't take it.
 */
export function restoreFields(
  t: Pick<Task, 'completed_at' | 'deleted_at' | 'dump'>,
  from: 'logbook' | 'trash',
  v: ViewKey,
  day: string,
): Partial<Task> | null {
  if (from === 'logbook' ? !t.completed_at : !t.deleted_at) return null;
  if (!FILE_KINDS.includes(v.kind)) return null;
  const f = listDropFields(v, day);
  return f && { completed_at: null, deleted_at: null, ...(t.dump ? { dump: 0, dump_section_id: null } : {}), ...f };
}
