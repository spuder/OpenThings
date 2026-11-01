/**
 * Dropping a Brain Dump item on a sidebar list (#132) turns it into a normal to-do in that list.
 * Pure, so the store and the tests share it. The item is converted in place: same id, same title
 * and notes, `dump` cleared, so it no longer fades after 48 hours.
 */
import { addDays } from './dates';
import type { Task, ViewKey } from './types';
import { weekStart } from './views';

/** Upcoming has no single day, so a drop there schedules the item for tomorrow (the first day Upcoming shows). */
export const upcomingDropDate = (day: string) => addDays(day, 1);

/** This Week: tomorrow, or today on the week's last day (Sunday), so it stays in This Week. */
export const weekDropDate = (day: string) => {
  const end = addDays(weekStart(day), 6);
  const next = addDays(day, 1);
  return next > end ? day : next;
};

const LEAVE_DUMP = { dump: 0, dump_section_id: null } as const;
const UNSCHEDULED = { when_date: null, evening: 0, someday: 0 } as const;

/**
 * The fields that turn Brain Dump item `t` into a to-do in list `v`, or null when `v` isn't a
 * list it can be converted into (Brain Dump itself, Logbook, Trash, Habits…) or `t` isn't an open
 * Brain Dump item.
 */
export function dumpDropFields(t: Pick<Task, 'dump' | 'completed_at'>, v: ViewKey, day: string): Partial<Task> | null {
  if (!t.dump || t.completed_at) return null;
  switch (v.kind) {
    case 'inbox':
      return { ...LEAVE_DUMP, ...UNSCHEDULED, project_id: null, area_id: null, heading_id: null };
    case 'today':
      return { ...LEAVE_DUMP, ...UNSCHEDULED, when_date: day };
    case 'upcoming':
      return { ...LEAVE_DUMP, ...UNSCHEDULED, when_date: upcomingDropDate(day) };
    case 'week':
      return { ...LEAVE_DUMP, ...UNSCHEDULED, when_date: weekDropDate(day) };
    case 'anytime':
      // Like moving any to-do to Anytime: without a project or area it shows in the Inbox.
      return { ...LEAVE_DUMP, ...UNSCHEDULED };
    case 'someday':
      return { ...LEAVE_DUMP, ...UNSCHEDULED, someday: 1 };
    case 'project':
      return { ...LEAVE_DUMP, project_id: v.id, area_id: null, heading_id: null };
    case 'area':
      return { ...LEAVE_DUMP, project_id: null, area_id: v.id, heading_id: null };
    default:
      return null;
  }
}

/** Sidebar lists a Brain Dump item can be dropped on. */
export const DUMP_DROP_KINDS: ViewKey['kind'][] = ['inbox', 'today', 'week', 'upcoming', 'anytime', 'someday', 'project', 'area'];
