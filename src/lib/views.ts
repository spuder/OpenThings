/** Pure view filters over task rows, so they can be unit tested. */
import type { Task } from './types';
import { addDays, parseYmd } from './dates';

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
  return habitStreak({ kind: 'daily' }, days, day).value;
}

// ---------- habit schedules ----------

/**
 * How often a habit is due.
 *   daily            every day
 *   days [1..5]      specific weekdays (0 = Sunday … 6 = Saturday)
 *   times perWeek    N times a week, any days (weeks start Monday)
 * Stored as a string: "daily" | "days:1,2,3,4,5" | "times:5".
 */
export type HabitSchedule = { kind: 'daily' } | { kind: 'days'; days: number[] } | { kind: 'times'; perWeek: number };

export function parseSchedule(s: string | null | undefined): HabitSchedule {
  if (!s || s === 'daily') return { kind: 'daily' };
  const days = /^days:([0-6](?:,[0-6])*)$/.exec(s);
  if (days) {
    const list = [...new Set(days[1].split(',').map(Number))].sort();
    return list.length === 7 ? { kind: 'daily' } : { kind: 'days', days: list };
  }
  const times = /^times:([1-7])$/.exec(s);
  if (times) return Number(times[1]) === 7 ? { kind: 'daily' } : { kind: 'times', perWeek: Number(times[1]) };
  return { kind: 'daily' };
}

export function scheduleToString(s: HabitSchedule): string {
  if (s.kind === 'days') return `days:${s.days.join(',')}`;
  if (s.kind === 'times') return `times:${s.perWeek}`;
  return 'daily';
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function describeSchedule(s: HabitSchedule): string {
  if (s.kind === 'daily') return 'Every day';
  if (s.kind === 'times') return `${s.perWeek}× a week`;
  const key = s.days.join(',');
  if (key === '1,2,3,4,5') return 'Weekdays';
  if (key === '0,6') return 'Weekends';
  // Monday-first order reads more naturally.
  return [...s.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAY_SHORT[d]).join(' ');
}

/** Whether a day is a "due" day. For N-times-a-week habits every day is eligible. */
export function isScheduledDay(s: HabitSchedule, day: string): boolean {
  if (s.kind !== 'days') return true;
  return s.days.includes(parseYmd(day).getDay());
}

/** Monday of the week containing `day`. */
export function weekStart(day: string): string {
  const wd = parseYmd(day).getDay();
  return addDays(day, -((wd + 6) % 7));
}

export function checksInWeek(days: Set<string>, day: string): number {
  const ws = weekStart(day);
  let n = 0;
  for (let i = 0; i < 7; i++) if (days.has(addDays(ws, i))) n++;
  return n;
}

/**
 * Streak that respects the schedule.
 *   daily / days: consecutive due days checked, ending today (or the last due day before it).
 *                 Days off neither break nor extend it.
 *   times:        consecutive weeks that met the target; this week counts once it's met.
 */
export function habitStreak(s: HabitSchedule, days: Set<string>, today: string): { value: number; unit: 'day' | 'week' } {
  if (s.kind === 'times') {
    let n = checksInWeek(days, today) >= s.perWeek ? 1 : 0;
    let ws = addDays(weekStart(today), -7);
    for (let i = 0; i < 520 && checksInWeek(days, ws) >= s.perWeek; i++) {
      n++;
      ws = addDays(ws, -7);
    }
    return { value: n, unit: 'week' };
  }
  let d = today;
  // Today doesn't break the streak until it's over.
  if (!days.has(d)) d = addDays(d, -1);
  let n = 0;
  for (let i = 0; i < 3660; i++) {
    if (days.has(d)) n++;
    else if (isScheduledDay(s, d)) break;
    d = addDays(d, -1);
  }
  return { value: n, unit: 'day' };
}

export interface ChallengeProgress {
  /** Day number of the challenge today (1-based), capped at total. */
  day: number;
  total: number;
  /** Checked days within the challenge window so far. */
  done: number;
  /** Check-ins the schedule asks for over the whole challenge. */
  required: number;
  /** Past days in the window that weren't checked. */
  missed: number;
  start: string;
  end: string;
  finished: boolean;
}

/** Progress through a fixed-length habit challenge (30/60/75 days…). */
export function challengeProgress(
  start: string,
  total: number,
  days: Set<string>,
  today: string,
  sched: HabitSchedule = { kind: 'daily' },
): ChallengeProgress {
  const end = addDays(start, total - 1);
  let done = 0;
  let missed = 0;
  let elapsed = 0;
  let required = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (sched.kind !== 'times' && isScheduledDay(sched, d)) required++;
    if (d > today) continue;
    elapsed++;
    if (days.has(d)) done++;
    else if (sched.kind !== 'times' && d < today && isScheduledDay(sched, d)) missed++;
  }
  if (sched.kind === 'times') {
    // Target scales with the window: N per 7 days. Missed = shortfall in finished weeks.
    required = Math.ceil((total / 7) * sched.perWeek);
    for (let ws = weekStart(start); ws <= today; ws = addDays(ws, 7)) {
      const weekEnd = addDays(ws, 6);
      if (weekEnd >= today) break;
      missed += Math.max(0, sched.perWeek - checksInWeek(days, ws));
    }
  }
  return {
    day: Math.min(Math.max(elapsed, 1), total),
    total,
    done,
    required,
    missed,
    start,
    end,
    finished: today > end || done >= required,
  };
}
