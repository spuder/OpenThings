/**
 * Time blocking (#99): pure helpers for the calendar. Times are local wall-clock strings,
 * `YYYY-MM-DDTHH:MM`, like dates elsewhere are local `YYYY-MM-DD`: a 9:00 block stays at 9:00
 * when you travel. A block lives within one day; its end may be the next day's 00:00.
 *
 * Written from scratch for this project. No browser imports, so the server can reuse it.
 */
import { addDays, parseYmd } from './dates';
import type { Area, ID, Project, Task, TimeBlock } from './types';

export type CalendarRange = 'day' | '3day' | 'week' | '4week';

export const RANGES: { id: CalendarRange; label: string; short: string; days: number }[] = [
  { id: 'day', label: 'Day', short: 'D', days: 1 },
  { id: '3day', label: '3 Days', short: '3', days: 3 },
  { id: 'week', label: '7 Days', short: '7', days: 7 },
  { id: '4week', label: '4 Weeks', short: '4W', days: 28 },
];

/** Grid snap, in minutes. */
export const SNAP_MIN = 15;
export const DAY_MIN = 24 * 60;
/** Shortest block. */
export const MIN_BLOCK = SNAP_MIN;

export function snap(min: number, step = SNAP_MIN): number {
  return Math.round(min / step) * step;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** `day` + minutes after midnight → `YYYY-MM-DDTHH:MM`. 1440 is the next day's 00:00. */
export function atTime(day: string, min: number): string {
  const d = min >= DAY_MIN ? addDays(day, Math.floor(min / DAY_MIN)) : day;
  const m = ((min % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${d}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function splitTime(s: string): { day: string; min: number } {
  const [day, hm = '00:00'] = s.split('T');
  const [h, m] = hm.split(':').map(Number);
  return { day, min: h * 60 + m };
}

/** A block as one day and a minute span on it (end 1440 = midnight). */
export function blockSpan(b: Pick<TimeBlock, 'start_at' | 'end_at'>): { day: string; start: number; end: number } {
  const s = splitTime(b.start_at);
  const e = splitTime(b.end_at);
  const end = e.day === s.day ? e.min : e.day === addDays(s.day, 1) && e.min === 0 ? DAY_MIN : DAY_MIN;
  return { day: s.day, start: s.min, end: Math.max(end, s.min) };
}

/** Normalise a span to the grid: snapped, at least MIN_BLOCK long, within the day. */
export function fitSpan(start: number, end: number): { start: number; end: number } {
  let a = clamp(snap(Math.min(start, end)), 0, DAY_MIN - MIN_BLOCK);
  let b = clamp(snap(Math.max(start, end)), 0, DAY_MIN);
  if (b - a < MIN_BLOCK) b = a + MIN_BLOCK;
  if (b > DAY_MIN) {
    b = DAY_MIN;
    a = b - MIN_BLOCK;
  }
  return { start: a, end: b };
}

/** Move a span by `delta` minutes, keeping its length and staying within the day. */
export function shiftSpan(start: number, end: number, delta: number): { start: number; end: number } {
  const len = end - start;
  const a = clamp(snap(start + delta), 0, DAY_MIN - len);
  return { start: a, end: a + len };
}

/** "9:00", "13:30"; 1440 shows as "24:00". */
export function clock(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

export function spanLabel(start: number, end: number): string {
  return `${clock(start)} – ${clock(end)}`;
}

/** Sunday on or before `day`: weeks start on Sunday. */
export function weekStart(day: string): string {
  return addDays(day, -parseYmd(day).getDay());
}

/** The days a range shows. Day and 3 days start at `anchor`; 7 days and 4 weeks start on its week's Sunday. */
export function rangeDays(range: CalendarRange, anchor: string): string[] {
  const n = RANGES.find((r) => r.id === range)!.days;
  const first = range === 'week' || range === '4week' ? weekStart(anchor) : anchor;
  return Array.from({ length: n }, (_, i) => addDays(first, i));
}

/** Where Previous / Next goes: by one range. */
export function stepAnchor(range: CalendarRange, anchor: string, dir: -1 | 1): string {
  return addDays(anchor, dir * RANGES.find((r) => r.id === range)!.days);
}

export function blocksOn(blocks: TimeBlock[], day: string): TimeBlock[] {
  return blocks
    .filter((b) => !b.deleted_at && b.start_at.startsWith(day))
    .sort((a, b) => a.start_at.localeCompare(b.start_at) || b.end_at.localeCompare(a.end_at));
}

export interface Placed {
  block: TimeBlock;
  start: number;
  end: number;
  /** Side-by-side lane and how many lanes its overlap cluster has. */
  lane: number;
  lanes: number;
}

/** Lay out one day's blocks: overlapping ones share the width in lanes, like a calendar. */
export function layoutDay(blocks: TimeBlock[]): Placed[] {
  const spans = blocks
    .map((block) => ({ block, ...blockSpan(block) }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const p of cluster) p.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };
  for (const s of spans) {
    if (s.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((e) => e <= s.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = s.end;
    const p: Placed = { block: s.block, start: s.start, end: s.end, lane, lanes: 1 };
    cluster.push(p);
    out.push(p);
    clusterEnd = Math.max(clusterEnd, s.end);
  }
  flush();
  return out;
}

// ---------- assignment ----------

export type Level = 'area' | 'project' | 'task';

export interface Assignment {
  area_id: ID | null;
  project_id: ID | null;
  task_id: ID | null;
}

/**
 * Check the assignment rules: a task needs its project, a project needs its area, and each one
 * must really sit inside the level above it. Returns an error message, or null when it's valid.
 */
export function assignmentError(a: Assignment, projects: Pick<Project, 'id' | 'area_id'>[], tasks: Pick<Task, 'id' | 'project_id'>[]): string | null {
  if (a.task_id && !a.project_id) return 'A to-do needs its project';
  if (a.project_id && !a.area_id) return 'A project needs its area';
  if (a.project_id) {
    const p = projects.find((x) => x.id === a.project_id);
    if (!p || p.area_id !== a.area_id) return 'That project is not in this area';
  }
  if (a.task_id) {
    const t = tasks.find((x) => x.id === a.task_id);
    if (!t || t.project_id !== a.project_id) return 'That to-do is not in this project';
  }
  return null;
}

/** The deepest level a block is assigned at, or null for a generic block. */
export function levelOf(a: Assignment): Level | null {
  return a.task_id ? 'task' : a.project_id ? 'project' : a.area_id ? 'area' : null;
}

/** The level the inline box asks for next, or null when the block is assigned all the way down. */
export function nextLevel(a: Assignment): Level | null {
  return a.task_id ? null : a.project_id ? 'task' : a.area_id ? 'project' : 'area';
}

/** Clear one level and everything below it (Backspace in an empty box steps back up). */
export function clearFrom(a: Assignment, level: Level): Assignment {
  if (level === 'area') return { area_id: null, project_id: null, task_id: null };
  if (level === 'project') return { ...a, project_id: null, task_id: null };
  return { ...a, task_id: null };
}

export interface Option {
  id: ID;
  name: string;
}

/** What the box can suggest at a level: areas, the area's open projects, the project's open to-dos. */
export function optionsFor(level: Level, a: Assignment, areas: Area[], projects: Project[], tasks: Task[]): Option[] {
  if (level === 'area') return areas.map((x) => ({ id: x.id, name: x.name }));
  if (level === 'project') return projects.filter((p) => p.area_id === a.area_id && !p.completed_at).map((p) => ({ id: p.id, name: p.name }));
  return tasks
    .filter((t) => t.project_id === a.project_id && !t.completed_at && !t.deleted_at)
    .sort((x, y) => x.sort - y.sort)
    .map((t) => ({ id: t.id, name: t.title }));
}

/**
 * Autocomplete: case-insensitive, names that start with the query first, then names with a word
 * that starts with it, then names that contain it. An empty query lists everything in order.
 */
export function matchOptions<T extends Option>(options: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  const rank = (name: string) => {
    const n = name.toLowerCase();
    if (n.startsWith(q)) return 0;
    if (n.split(/[\s\-_/]+/).some((w) => w.startsWith(q))) return 1;
    if (n.includes(q)) return 2;
    return -1;
  };
  return options
    .map((o, i) => ({ o, i, r: rank(o.name) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.o);
}

/** The rest of `name` to show greyed after what was typed, when it's a prefix match. */
export function inlineCompletion(name: string | undefined, query: string): string {
  if (!name || !query) return '';
  return name.toLowerCase().startsWith(query.toLowerCase()) ? name.slice(query.length) : '';
}

/** Title and breadcrumb for a block: its deepest level, with the levels above it. */
export function blockLabel(b: TimeBlock, areas: Area[], projects: Project[], tasks: Task[]): { title: string; crumbs: string[] } {
  const area = b.area_id ? areas.find((x) => x.id === b.area_id)?.name : undefined;
  const project = b.project_id ? projects.find((x) => x.id === b.project_id)?.name : undefined;
  const task = b.task_id ? tasks.find((x) => x.id === b.task_id)?.title : undefined;
  const chain = [area, project, task].filter((x): x is string => !!x);
  const named = b.title?.trim();
  if (!chain.length) return { title: named || '', crumbs: [] };
  // A named block in an area (a to-do of that area dropped on the calendar): the name, under the area.
  if (named && !b.project_id) return { title: named, crumbs: chain };
  return { title: chain[chain.length - 1], crumbs: chain.slice(0, -1) };
}

// ---------- dropping lists and to-dos on the calendar ----------

/** Something dragged onto the calendar: an area or project from the sidebar, or a to-do. */
export interface BlockSource {
  kind: 'area' | 'project' | 'task';
  id: ID;
}

/**
 * The block a dropped area, project or to-do becomes. It's linked as deep as the rules allow
 * (area › project › to-do). What can't be linked keeps its name: a project with no area, or a
 * to-do in the Inbox, becomes a plain named block; a to-do directly in an area, a named block
 * in that area. Null when the source no longer exists.
 */
export function sourceBlock(
  src: BlockSource,
  areas: Pick<Area, 'id'>[],
  projects: Pick<Project, 'id' | 'area_id' | 'name'>[],
  tasks: Pick<Task, 'id' | 'project_id' | 'area_id' | 'title'>[],
): { assignment: Assignment; title: string | null; label: string } | null {
  const none: Assignment = { area_id: null, project_id: null, task_id: null };
  const hasArea = (id: ID | null): id is ID => !!id && areas.some((a) => a.id === id);
  if (src.kind === 'area') return hasArea(src.id) ? { assignment: { ...none, area_id: src.id }, title: null, label: '' } : null;
  if (src.kind === 'project') {
    const p = projects.find((x) => x.id === src.id);
    if (!p) return null;
    if (hasArea(p.area_id)) return { assignment: { area_id: p.area_id, project_id: p.id, task_id: null }, title: null, label: p.name };
    return { assignment: none, title: p.name, label: p.name };
  }
  const t = tasks.find((x) => x.id === src.id);
  if (!t) return null;
  const p = t.project_id ? projects.find((x) => x.id === t.project_id) : undefined;
  if (p && hasArea(p.area_id)) return { assignment: { area_id: p.area_id, project_id: p.id, task_id: t.id }, title: null, label: t.title };
  if (!p && hasArea(t.area_id)) return { assignment: { ...none, area_id: t.area_id }, title: t.title, label: t.title };
  return { assignment: none, title: t.title, label: t.title };
}

/** How long a dropped block is: the to-do's estimate (15 minutes to 8 hours), otherwise an hour. */
export function sourceMinutes(src: BlockSource, tasks: Pick<Task, 'id' | 'estimate_min'>[]): number {
  const est = src.kind === 'task' ? tasks.find((t) => t.id === src.id)?.estimate_min : null;
  return est && est > 0 ? clamp(Math.ceil(est / SNAP_MIN) * SNAP_MIN, MIN_BLOCK, 8 * 60) : 60;
}

/** Where a block of `minutes` lands when dropped at minute `at` of a day: its slot, kept within the day. */
export function dropSpan(at: number, minutes: number): { start: number; end: number } {
  const start = clamp(Math.floor(at / SNAP_MIN) * SNAP_MIN, 0, DAY_MIN - minutes);
  return { start, end: start + minutes };
}

/** Area colors reuse the list tokens in app.css, so blocks add no new colors. */
const AREA_COLORS = ['--inbox', '--anytime', '--habits', '--matrix', '--logbook', '--week', '--dump', '--evening', '--someday', '--upcoming'];

/** A block's color: its area's (by the area's place in the sidebar), gray when it has none. */
export function blockColor(areaId: ID | null, areas: Pick<Area, 'id'>[]): string {
  const i = areaId ? areas.findIndex((a) => a.id === areaId) : -1;
  return i < 0 ? 'var(--text-3)' : `var(${AREA_COLORS[i % AREA_COLORS.length]})`;
}
