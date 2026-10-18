/** Pure view filters over task rows, so they can be unit tested. */
import type { Task } from './types';
import { addDays } from './dates';

export const DUMP_TTL_MS = 48 * 60 * 60 * 1000;

/** Open tasks, plus tasks completed this session so they stay visible (checked) until you leave the view. */
function visible(t: Task, keep: Set<string>): boolean {
  return t.completed_at === null || keep.has(t.id);
}

const bySort = (a: Task, b: Task) => a.sort - b.sort;

export function dumpAgeFraction(t: Task, now: number): number {
  const age = now - Date.parse(t.created_at);
  return Math.min(1, Math.max(0, age / DUMP_TTL_MS));
}

export function isDumpExpired(t: Task, now: number): boolean {
  return t.dump === 1 && t.completed_at === null && now - Date.parse(t.created_at) >= DUMP_TTL_MS;
}

export function inbox(tasks: Task[], keep: Set<string>): Task[] {
  return tasks
    .filter(
      (t) =>
        visible(t, keep) &&
        !t.dump &&
        !t.someday &&
        !t.when_date &&
        !t.project_id &&
        !t.area_id,
    )
    .sort(bySort);
}

export function todayView(tasks: Task[], day: string, keep: Set<string>): { day: Task[]; evening: Task[] } {
  const due = tasks
    .filter(
      (t) =>
        visible(t, keep) &&
        !t.dump &&
        !t.someday &&
        ((t.when_date !== null && t.when_date <= day) || (t.deadline !== null && t.deadline <= day)),
    )
    .sort(bySort);
  return { day: due.filter((t) => !t.evening), evening: due.filter((t) => t.evening) };
}

export function upcoming(tasks: Task[], day: string, keep: Set<string>, horizonDays = 30): { date: string; tasks: Task[] }[] {
  const end = addDays(day, horizonDays);
  const future = tasks.filter(
    (t) => visible(t, keep) && !t.dump && t.when_date !== null && t.when_date > day && t.when_date <= end,
  );
  const groups = new Map<string, Task[]>();
  for (const t of future) {
    const k = t.when_date!;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, ts]) => ({ date, tasks: ts.sort(bySort) }));
}

/** Anytime: everything actionable now that isn't in the Inbox, Someday, or scheduled for later. */
export function anytime(tasks: Task[], day: string, keep: Set<string>): Task[] {
  return tasks
    .filter(
      (t) =>
        visible(t, keep) &&
        !t.dump &&
        !t.someday &&
        (t.when_date === null || t.when_date <= day) &&
        (t.project_id !== null || t.area_id !== null || t.when_date !== null),
    )
    .sort(bySort);
}

export function someday(tasks: Task[], keep: Set<string>): Task[] {
  return tasks.filter((t) => visible(t, keep) && !t.dump && t.someday === 1).sort(bySort);
}

export function logbook(tasks: Task[]): Task[] {
  return tasks
    .filter((t) => t.completed_at !== null)
    .sort((a, b) => b.completed_at!.localeCompare(a.completed_at!));
}

export function dump(tasks: Task[], keep: Set<string>, now: number): Task[] {
  return tasks
    .filter((t) => t.dump === 1 && visible(t, keep) && !isDumpExpired(t, now))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export type Quadrant = 'do' | 'schedule' | 'delegate' | 'drop';

export function quadrantOf(t: Task): Quadrant {
  if (t.urgent && t.important) return 'do';
  if (!t.urgent && t.important) return 'schedule';
  if (t.urgent && !t.important) return 'delegate';
  return 'drop';
}

/** Matrix shows open, non-dump, non-someday tasks. */
export function matrix(tasks: Task[], keep: Set<string>): Record<Quadrant, Task[]> {
  const out: Record<Quadrant, Task[]> = { do: [], schedule: [], delegate: [], drop: [] };
  for (const t of tasks.filter((t) => visible(t, keep) && !t.dump && !t.someday).sort(bySort)) {
    out[quadrantOf(t)].push(t);
  }
  return out;
}

/** Current streak: consecutive checked days ending today (or yesterday if today isn't checked yet). */
export function streak(days: Set<string>, day: string): number {
  let d = days.has(day) ? day : addDays(day, -1);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}
