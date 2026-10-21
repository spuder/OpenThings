/**
 * To-do actions for the REST API and MCP tools. Mirrors the app's store (src/lib/store.svelte.ts)
 * so a to-do added here looks exactly like one added in the app, and reuses its pure modules:
 * quick-add parsing (parse.ts), view filters (views.ts) and dates (dates.ts).
 */
import { addDays, shiftReminder, today as localToday } from '../src/lib/dates';
import {
  describeRule,
  firstOccurrence,
  nextRepeat,
  parseDateWord,
  parseHabit,
  parseQuickAdd,
  parseReminder,
  parseRepeat,
  parseWhen,
  pinRepeat,
  type Parsed,
} from '../src/lib/parse';
import { formatRule, parseRule } from '../src/lib/rrule';
import { mergeTags, uuid7, type Row } from '../src/lib/schema';
import type { Area, ChecklistItem, Habit, Project, Tag, Task, TaskTag, TimeEntry } from '../src/lib/types';
import * as V from '../src/lib/views';
import type { ServerDb } from './db';

/** A request the caller got wrong: unknown id, bad date… Becomes a 400/404, or an MCP tool error. */
export class UserError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export const VIEWS = ['inbox', 'today', 'week', 'upcoming', 'anytime', 'someday', 'logbook', 'dump', 'trash', 'matrix', 'all'] as const;
export type ViewName = (typeof VIEWS)[number];

export interface TaskOut extends Task {
  tags: string[];
  project: string | null;
  area: string | null;
  checklist: { id: string; title: string; done: boolean }[];
  repeat: string | null;
  /** Grouping from the view: day for upcoming/week, quadrant for matrix, "evening" for Today. */
  group?: string;
}

export interface TaskInput {
  /** Quick-add text, parsed like the app's quick add. */
  text?: string;
  /** Literal title (no quick-add parsing). */
  title?: string;
  notes?: string;
  /** today, tonight, tomorrow, someday, anytime, inbox, fri, 2026-11-02… */
  when?: string | null;
  deadline?: string | null;
  /** "9am", "fri 9am", "in 30m", or an ISO timestamp. */
  reminder?: string | null;
  /** daily, weekly, weekdays, 2w, mon,thu, 1st,15th, last-fri… or an RRULE (FREQ=…). */
  repeat?: string | null;
  project?: string | null;
  area?: string | null;
  tags?: string[];
  urgent?: boolean;
  important?: boolean;
  estimate_min?: number | null;
  /** Put it in the Brain Dump (expires in 48 hours unless moved or checked). */
  dump?: boolean;
  dump_section?: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[-_\s]+/g, ' ').trim();
const nextSort = () => Date.now() / 1000;

export class Service {
  constructor(
    readonly db: ServerDb,
    /** Today in the server's time zone (set TZ in the container). */
    readonly today: () => string = () => localToday(),
  ) {}

  // ---------- reads ----------

  /** Tags and task links, with same-named tags (created on two devices) merged into one. */
  private tagData() {
    return mergeTags(this.db.all<Tag>('SELECT * FROM tags ORDER BY name'), this.db.all<TaskTag>('SELECT * FROM task_tags'));
  }

  private openTasks(): Task[] {
    return this.db.all<Task>('SELECT * FROM tasks WHERE deleted_at IS NULL');
  }

  task(id: string): Task {
    const t = this.db.one<Task>('SELECT * FROM tasks WHERE id = ?', [id]);
    if (!t) throw new UserError(`No to-do with id ${id}`, 404);
    return t;
  }

  /** Task rows with tags, container names and checklist attached. */
  present(tasks: Task[], group?: (t: Task) => string | undefined): TaskOut[] {
    if (!tasks.length) return [];
    const tagData = this.tagData();
    const tags = new Map(tagData.tags.map((t) => [t.id, t.name]));
    const projects = new Map(this.db.all<Project>('SELECT * FROM projects').map((p) => [p.id, p.name]));
    const areas = new Map(this.db.all<Area>('SELECT * FROM areas').map((a) => [a.id, a.name]));
    const ids = new Set(tasks.map((t) => t.id));
    const tagsOf = new Map<string, string[]>();
    for (const tt of tagData.links) {
      if (!ids.has(tt.task_id) || !tags.has(tt.tag_id)) continue;
      const list = tagsOf.get(tt.task_id) ?? [];
      if (!list.includes(tags.get(tt.tag_id)!)) tagsOf.set(tt.task_id, [...list, tags.get(tt.tag_id)!]);
    }
    const checklistOf = new Map<string, TaskOut['checklist']>();
    for (const c of this.db.all<ChecklistItem>('SELECT * FROM checklist ORDER BY sort')) {
      if (!ids.has(c.task_id)) continue;
      checklistOf.set(c.task_id, [...(checklistOf.get(c.task_id) ?? []), { id: c.id, title: c.title, done: !!c.done }]);
    }
    return tasks.map((t) => {
      const out: TaskOut = {
        ...t,
        tags: tagsOf.get(t.id) ?? [],
        project: t.project_id ? (projects.get(t.project_id) ?? null) : null,
        area: t.area_id ? (areas.get(t.area_id) ?? null) : null,
        checklist: checklistOf.get(t.id) ?? [],
        repeat: t.rrule ? describeRule(t.rrule, this.today()) : null,
      };
      const g = group?.(t);
      if (g) out.group = g;
      return out;
    });
  }

  getTask(id: string): TaskOut {
    return this.present([this.task(id)])[0];
  }

  /** A list as the app shows it, optionally narrowed to a project, area or tag. */
  list(opts: { view?: string; project?: string; area?: string; tag?: string; include_completed?: boolean; limit?: number } = {}): TaskOut[] {
    const view = (opts.view ?? (opts.project || opts.area || opts.tag ? 'all' : 'today')) as ViewName;
    if (!VIEWS.includes(view)) throw new UserError(`Unknown view "${opts.view}". Use one of: ${VIEWS.join(', ')}`);
    const day = this.today();
    const keep = new Set<string>();
    let tasks = this.openTasks();

    if (opts.project) {
      const p = this.findProject(opts.project);
      tasks = tasks.filter((t) => t.project_id === p.id);
    }
    if (opts.area) {
      const a = this.findArea(opts.area);
      const inArea = new Set(this.db.all<Project>('SELECT id FROM projects WHERE area_id = ?', [a.id]).map((p) => p.id));
      tasks = tasks.filter((t) => t.area_id === a.id || (t.project_id !== null && inArea.has(t.project_id)));
    }
    if (opts.tag) {
      const { tags, links } = this.tagData();
      const tag = tags.find((t) => t.id === opts.tag || norm(t.name) === norm(opts.tag!.replace(/^#/, '')));
      if (!tag) throw new UserError(`No tag named "${opts.tag}"`, 404);
      const tagged = new Set(links.filter((l) => l.tag_id === tag.id).map((l) => l.task_id));
      tasks = tasks.filter((t) => tagged.has(t.id));
    }

    let out: TaskOut[];
    const groupBy = new Map<string, string>();
    const flat = (groups: { date: string; tasks: Task[] }[]) => groups.flatMap((g) => g.tasks.map((t) => (groupBy.set(t.id, g.date), t)));
    switch (view) {
      case 'inbox': out = this.present(V.inbox(tasks, keep)); break;
      case 'today': {
        const { day: d, evening } = V.todayView(tasks, day, keep);
        for (const t of evening) groupBy.set(t.id, 'evening');
        out = this.present([...d, ...evening], (t) => groupBy.get(t.id));
        break;
      }
      case 'week': out = this.present(flat(V.thisWeek(tasks, day, keep)), (t) => groupBy.get(t.id)); break;
      case 'upcoming': out = this.present(flat(V.upcoming(tasks, day, keep)), (t) => groupBy.get(t.id)); break;
      case 'anytime': out = this.present(V.anytime(tasks, day, keep)); break;
      case 'someday': out = this.present(V.someday(tasks, keep)); break;
      case 'logbook': out = this.present(V.logbook(tasks)); break;
      case 'dump': out = this.present(V.dump(tasks, keep, Date.now())); break;
      case 'trash': out = this.present(this.db.all<Task>('SELECT * FROM tasks WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC')); break;
      case 'matrix': {
        const m = V.matrix(tasks, keep);
        const all = (Object.keys(m) as V.Quadrant[]).flatMap((q) => m[q].map((t) => (groupBy.set(t.id, q), t)));
        out = this.present(all, (t) => groupBy.get(t.id));
        break;
      }
      case 'all': {
        const now = Date.now();
        const open = tasks.filter((t) => (opts.include_completed || t.completed_at === null) && !V.isDumpExpired(t, now));
        out = this.present(open.sort((a, b) => a.sort - b.sort));
        break;
      }
    }
    return opts.limit ? out.slice(0, opts.limit) : out;
  }

  /** Find to-dos whose title or notes contain every word of the query. */
  search(query: string, opts: { include_completed?: boolean; limit?: number } = {}): TaskOut[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) throw new UserError('Search for at least one word');
    const now = Date.now();
    const hits = this.openTasks().filter((t) => {
      if (!opts.include_completed && t.completed_at) return false;
      if (V.isDumpExpired(t, now)) return false;
      const hay = `${t.title}\n${t.notes}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    hits.sort((a, b) => Number(!!a.completed_at) - Number(!!b.completed_at) || b.created_at.localeCompare(a.created_at));
    return this.present(hits.slice(0, opts.limit ?? 50));
  }

  projects(): (Project & { area: string | null; open: number })[] {
    const areas = new Map(this.db.all<Area>('SELECT * FROM areas').map((a) => [a.id, a.name]));
    const counts = new Map(
      this.db
        .all<{ project_id: string; n: number }>('SELECT project_id, COUNT(*) AS n FROM tasks WHERE deleted_at IS NULL AND completed_at IS NULL AND project_id IS NOT NULL GROUP BY project_id')
        .map((r) => [r.project_id, r.n]),
    );
    return this.db
      .all<Project>('SELECT * FROM projects ORDER BY sort')
      .map((p) => ({ ...p, area: p.area_id ? (areas.get(p.area_id) ?? null) : null, open: counts.get(p.id) ?? 0 }));
  }

  areas(): Area[] {
    return this.db.all<Area>('SELECT * FROM areas ORDER BY sort');
  }

  tags(): (Tag & { open: number })[] {
    const { tags, links } = this.tagData();
    const open = new Set(this.db.all<{ id: string }>('SELECT id FROM tasks WHERE deleted_at IS NULL AND completed_at IS NULL').map((t) => t.id));
    const counts = new Map<string, Set<string>>();
    for (const l of links) if (open.has(l.task_id)) counts.set(l.tag_id, (counts.get(l.tag_id) ?? new Set()).add(l.task_id));
    return tags.map((t) => ({ ...t, open: counts.get(t.id)?.size ?? 0 }));
  }

  // ---------- lookups ----------

  private findByName<T extends { id: string; name: string }>(rows: T[], ref: string): T | undefined {
    const n = norm(ref.replace(/^\+/, ''));
    return rows.find((r) => r.id === ref) ?? rows.find((r) => norm(r.name) === n) ?? rows.find((r) => norm(r.name).startsWith(n));
  }

  findProject(ref: string): Project {
    const p = this.findByName(this.db.all<Project>('SELECT * FROM projects ORDER BY sort'), ref);
    if (!p) throw new UserError(`No project named "${ref}"`, 404);
    return p;
  }

  findArea(ref: string): Area {
    const a = this.findByName(this.db.all<Area>('SELECT * FROM areas ORDER BY sort'), ref);
    if (!a) throw new UserError(`No area named "${ref}"`, 404);
    return a;
  }

  /** Quick add's rule: a project or area by name, else a new project. */
  private resolveContainer(name: string): { project_id: string | null; area_id: string | null } {
    const p = this.findByName(this.db.all<Project>('SELECT * FROM projects ORDER BY sort'), name);
    if (p) return { project_id: p.id, area_id: null };
    const a = this.findByName(this.db.all<Area>('SELECT * FROM areas ORDER BY sort'), name);
    if (a) return { project_id: null, area_id: a.id };
    const id = uuid7();
    this.db.insert('projects', { id, area_id: null, name, notes: '', sort: nextSort(), completed_at: null });
    return { project_id: id, area_id: null };
  }

  private tagId(name: string): string {
    const clean = name.replace(/^#/, '').trim();
    const existing = this.db.one<Tag>('SELECT * FROM tags WHERE lower(name) = lower(?) ORDER BY id LIMIT 1', [clean]);
    if (existing) return existing.id;
    const id = uuid7();
    this.db.insert('tags', { id, name: clean });
    return id;
  }

  private dumpSectionId(name: string): string {
    const s = this.db.all<{ id: string; name: string }>('SELECT * FROM dump_sections').find((x) => norm(x.name) === norm(name));
    if (s) return s.id;
    const id = uuid7();
    this.db.insert('dump_sections', { id, name, sort: nextSort() });
    return id;
  }

  // ---------- field parsing ----------

  private when(v: string | null): Pick<Task, 'when_date' | 'evening' | 'someday'> & { inbox: boolean } {
    if (v === null || v === '') return { when_date: null, evening: 0, someday: 0, inbox: false };
    const w = parseWhen(v.trim().replace(/^@/, '').replace(/\s+/g, '-'), this.today());
    if (!w) throw new UserError(`Unknown date "${v}"`);
    return { when_date: w.date, evening: w.evening ? 1 : 0, someday: w.someday ? 1 : 0, inbox: w.inbox };
  }

  private date(v: string | null, what: string): string | null {
    if (v === null || v === '') return null;
    const d = parseDateWord(v.trim().replace(/^!/, '').replace(/\s+/g, '-'), this.today());
    if (!d) throw new UserError(`Unknown ${what} "${v}"`);
    return d;
  }

  private reminder(v: string | null, baseDay: string | null): string | null {
    if (v === null || v === '') return null;
    const spec = v.trim().replace(/^%/, '');
    if (/^\d{4}-\d{2}-\d{2}T/.test(spec) && !Number.isNaN(Date.parse(spec))) return new Date(spec).toISOString();
    const at = parseReminder(spec, baseDay ?? this.today());
    if (!at) throw new UserError(`Unknown reminder time "${v}"`);
    return at;
  }

  private repeat(v: string | null): string | null {
    if (v === null || v === '') return null;
    if (/^(RRULE:)?FREQ=/i.test(v.trim())) {
      const rule = parseRule(v);
      if (!rule) throw new UserError(`Unknown repeat rule "${v}"`);
      return formatRule(rule);
    }
    const r = parseRepeat(v.trim().replace(/^\*/, ''));
    if (!r) throw new UserError(`Unknown repeat "${v}"`);
    return r;
  }

  // ---------- task writes ----------

  /** Create a to-do from quick-add text and/or fields (fields win over the text). */
  addTask(input: TaskInput): TaskOut {
    const day = this.today();
    const p: Parsed = input.text !== undefined ? parseQuickAdd(input.text, day) : parseQuickAdd('', day);
    if (input.title !== undefined) p.title = input.title.trim();
    if (!p.title) throw new UserError('A to-do needs a title (send "text" or "title")');
    const id = uuid7();
    const row: Task = {
      id,
      title: p.title,
      notes: input.notes ?? p.notes,
      project_id: null,
      area_id: null,
      heading_id: null,
      when_date: p.when?.date ?? null,
      evening: p.when?.evening ? 1 : 0,
      someday: p.when?.someday ? 1 : 0,
      deadline: p.deadline,
      completed_at: null,
      created_at: new Date().toISOString(),
      sort: nextSort(),
      urgent: (input.urgent ?? p.urgent) ? 1 : 0,
      important: (input.important ?? p.important) ? 1 : 0,
      estimate_min: input.estimate_min !== undefined ? input.estimate_min : p.estimateMin,
      rrule: p.rrule,
      dump: 0,
      dump_section_id: null,
      deleted_at: null,
      reminder_at: p.reminderAt,
      reminder_sent_at: null,
    };
    if (input.when !== undefined) {
      const { inbox: _inbox, ...w } = this.when(input.when);
      Object.assign(row, w);
    }
    if (input.deadline !== undefined) row.deadline = this.date(input.deadline, 'deadline');
    if (input.repeat !== undefined) {
      row.rrule = this.repeat(input.repeat);
      // As in quick add: no date means the first matching day from today.
      if (row.rrule && !row.when_date && !row.someday) row.when_date = firstOccurrence(row.rrule, day) ?? day;
      if (row.rrule && row.when_date) row.rrule = pinRepeat(row.rrule, row.when_date);
    }
    if (input.reminder !== undefined) row.reminder_at = this.reminder(input.reminder, row.when_date);

    const tags = [...p.tags, ...(input.tags ?? [])];
    this.db.tx(() => {
      if (input.project) Object.assign(row, { project_id: this.findProject(input.project).id, area_id: null });
      else if (input.area) Object.assign(row, { project_id: null, area_id: this.findArea(input.area).id });
      else if (p.project) Object.assign(row, this.resolveContainer(p.project));
      if (input.dump ?? p.dump) {
        row.dump = 1;
        const section = input.dump_section ?? p.dumpSection;
        row.dump_section_id = section ? this.dumpSectionId(section) : null;
      }
      this.db.insert('tasks', row as unknown as Row & { id: string });
      const seen = new Set<string>();
      for (const name of tags) {
        const tagId = this.tagId(name);
        if (seen.has(tagId)) continue;
        seen.add(tagId);
        this.db.insert('task_tags', { id: uuid7(), task_id: id, tag_id: tagId });
      }
    });
    return this.getTask(id);
  }

  updateTask(id: string, input: Omit<TaskInput, 'text' | 'dump' | 'dump_section'> & { tags?: string[]; add_tags?: string[]; remove_tags?: string[] }): TaskOut {
    const t = this.task(id);
    const fields: Partial<Task> = {};
    if (input.title !== undefined) {
      if (!input.title.trim()) throw new UserError('Title cannot be empty');
      fields.title = input.title.trim();
    }
    if (input.notes !== undefined) fields.notes = input.notes ?? '';
    if (input.when !== undefined) {
      const { inbox, ...w } = this.when(input.when);
      Object.assign(fields, w, inbox ? { project_id: null, area_id: null, heading_id: null } : {});
    }
    if (input.deadline !== undefined) fields.deadline = this.date(input.deadline, 'deadline');
    if (input.repeat !== undefined) {
      fields.rrule = this.repeat(input.repeat);
      const day = fields.when_date ?? t.when_date;
      if (fields.rrule && day) fields.rrule = pinRepeat(fields.rrule, day);
    }
    if (input.reminder !== undefined) {
      fields.reminder_at = this.reminder(input.reminder, fields.when_date ?? t.when_date);
      fields.reminder_sent_at = null;
    }
    if (input.urgent !== undefined) fields.urgent = input.urgent ? 1 : 0;
    if (input.important !== undefined) fields.important = input.important ? 1 : 0;
    if (input.estimate_min !== undefined) fields.estimate_min = input.estimate_min;
    this.db.tx(() => {
      if (input.project !== undefined || input.area !== undefined) Object.assign(fields, this.placement(t, { project: input.project, area: input.area }));
      if (Object.keys(fields).length) this.db.update('tasks', id, fields as Row);
      const current = this.tagData().links.filter((l) => l.task_id === id);
      let want: Set<string> | null = null;
      if (input.tags) want = new Set(input.tags.map((n) => this.tagId(n)));
      if (input.add_tags || input.remove_tags) {
        want ??= new Set(current.map((c) => c.tag_id));
        for (const n of input.add_tags ?? []) want.add(this.tagId(n));
        for (const n of input.remove_tags ?? []) {
          const tag = this.db.one<Tag>('SELECT * FROM tags WHERE lower(name) = lower(?) ORDER BY id LIMIT 1', [n.replace(/^#/, '')]);
          if (tag) want.delete(tag.id);
        }
      }
      if (want) {
        for (const c of current) if (!want.has(c.tag_id)) this.db.remove('task_tags', c.id);
        const have = new Set(current.map((c) => c.tag_id));
        for (const tagId of want) if (!have.has(tagId)) this.db.insert('task_tags', { id: uuid7(), task_id: id, tag_id: tagId });
      }
    });
    return this.getTask(id);
  }

  /** Placement fields for a move; leaving the brain dump makes a to-do permanent. */
  private placement(t: Task, to: { project?: string | null; area?: string | null; inbox?: boolean }): Partial<Task> {
    const fields: Partial<Task> = { project_id: null, area_id: null, heading_id: null };
    if (to.project) fields.project_id = this.findProject(to.project).id;
    else if (to.area) fields.area_id = this.findArea(to.area).id;
    if (to.inbox) Object.assign(fields, { when_date: null, evening: 0, someday: 0 });
    if (t.dump) Object.assign(fields, { dump: 0, dump_section_id: null });
    return fields;
  }

  /** Move to a project, an area, the Inbox, or the Brain Dump. */
  moveTask(id: string, to: { project?: string | null; area?: string | null; inbox?: boolean; dump?: boolean; dump_section?: string | null }): TaskOut {
    const t = this.task(id);
    if (!to.project && !to.area && !to.inbox && !to.dump) throw new UserError('Say where to: project, area, inbox or dump');
    this.db.tx(() => {
      if (to.dump) {
        this.db.update('tasks', id, { dump: 1, dump_section_id: to.dump_section ? this.dumpSectionId(to.dump_section) : null });
      } else {
        this.db.update('tasks', id, this.placement(t, to) as Row);
      }
    });
    return this.getTask(id);
  }

  /** Check off a to-do. A repeating one schedules its next occurrence, as in the app. */
  completeTask(id: string): { task: TaskOut; next: TaskOut | null } {
    const t = this.task(id);
    if (t.deleted_at) throw new UserError('That to-do is in the Trash; restore it first');
    if (t.completed_at) return { task: this.present([t])[0], next: null };
    let nextId: string | null = null;
    this.db.tx(() => {
      const now = new Date().toISOString();
      this.db.update('tasks', id, { completed_at: now });
      for (const e of this.db.all<TimeEntry>('SELECT * FROM time_entries WHERE task_id = ? AND end_at IS NULL', [id])) this.db.update('time_entries', e.id, { end_at: now });
      if (!t.rrule) return;
      const day = this.today();
      const from = t.when_date && t.when_date > day ? t.when_date : day;
      // Same as the app: counted from the to-do's own date; nothing more once COUNT or UNTIL runs out.
      const repeat = nextRepeat(t.rrule, from, t.when_date ?? from);
      if (!repeat) return;
      const next = repeat.date;
      nextId = uuid7();
      this.db.insert('tasks', {
        ...(t as unknown as Row),
        id: nextId,
        rrule: repeat.rrule,
        when_date: next,
        completed_at: null,
        created_at: now,
        reminder_at: t.reminder_at ? shiftReminder(t.reminder_at, t.when_date ?? day, next) : null,
        reminder_sent_at: null,
      });
      for (const tt of this.db.all<{ tag_id: string }>('SELECT tag_id FROM task_tags WHERE task_id = ?', [id])) this.db.insert('task_tags', { id: uuid7(), task_id: nextId, tag_id: tt.tag_id });
      for (const c of this.db.all<ChecklistItem>('SELECT * FROM checklist WHERE task_id = ? ORDER BY sort', [id]))
        this.db.insert('checklist', { id: uuid7(), task_id: nextId, title: c.title, done: 0, sort: c.sort });
    });
    return { task: this.getTask(id), next: nextId ? this.getTask(nextId) : null };
  }

  uncompleteTask(id: string): TaskOut {
    const t = this.task(id);
    if (t.completed_at) this.db.tx(() => this.db.update('tasks', id, { completed_at: null }));
    return this.getTask(id);
  }

  /** Move to the Trash (restorable for 30 days). */
  trashTask(id: string): TaskOut {
    const t = this.task(id);
    if (!t.deleted_at) {
      this.db.tx(() => {
        const now = new Date().toISOString();
        this.db.update('tasks', id, { deleted_at: now });
        for (const e of this.db.all<TimeEntry>('SELECT * FROM time_entries WHERE task_id = ? AND end_at IS NULL', [id])) this.db.update('time_entries', e.id, { end_at: now });
      });
    }
    return this.getTask(id);
  }

  restoreTask(id: string): TaskOut {
    const t = this.task(id);
    if (t.deleted_at) {
      const orphan =
        (t.project_id && !this.db.one('SELECT 1 AS x FROM projects WHERE id = ?', [t.project_id])) ||
        (t.area_id && !this.db.one('SELECT 1 AS x FROM areas WHERE id = ?', [t.area_id]));
      this.db.tx(() => this.db.update('tasks', id, orphan ? { deleted_at: null, project_id: null, area_id: null, heading_id: null } : { deleted_at: null }));
    }
    return this.getTask(id);
  }

  addChecklistItem(taskId: string, title: string): TaskOut {
    this.task(taskId);
    if (!title.trim()) throw new UserError('Checklist item needs a title');
    this.db.tx(() => this.db.insert('checklist', { id: uuid7(), task_id: taskId, title: title.trim(), done: 0, sort: nextSort() }));
    return this.getTask(taskId);
  }

  setChecklistItem(itemId: string, done: boolean): TaskOut {
    const c = this.db.one<ChecklistItem>('SELECT * FROM checklist WHERE id = ?', [itemId]);
    if (!c) throw new UserError(`No checklist item with id ${itemId}`, 404);
    this.db.tx(() => this.db.update('checklist', itemId, { done: done ? 1 : 0 }));
    return this.getTask(c.task_id);
  }

  // ---------- projects and areas ----------

  addProject(name: string, area?: string | null): Project {
    if (!name.trim()) throw new UserError('A project needs a name');
    const id = uuid7();
    const areaId = area ? this.findArea(area).id : null;
    this.db.tx(() => this.db.insert('projects', { id, area_id: areaId, name: name.trim(), notes: '', sort: nextSort(), completed_at: null }));
    return this.db.one<Project>('SELECT * FROM projects WHERE id = ?', [id])!;
  }

  addArea(name: string): Area {
    if (!name.trim()) throw new UserError('An area needs a name');
    const id = uuid7();
    this.db.tx(() => this.db.insert('areas', { id, name: name.trim(), sort: nextSort() }));
    return this.db.one<Area>('SELECT * FROM areas WHERE id = ?', [id])!;
  }

  // ---------- habits ----------

  habits(day = this.today()) {
    const checks = this.db.all<{ habit_id: string; day: string }>('SELECT habit_id, day FROM habit_checks');
    return this.db.all<Habit>('SELECT * FROM habits ORDER BY sort').map((h) => {
      const days = new Set(checks.filter((c) => c.habit_id === h.id).map((c) => c.day));
      const schedule = V.parseSchedule(h.schedule);
      const streak = V.habitStreak(schedule, days, day);
      return {
        ...h,
        schedule_label: V.describeSchedule(schedule),
        checked_today: days.has(day),
        due_today: V.isScheduledDay(schedule, day),
        streak: streak.value,
        streak_unit: streak.unit,
        recent: [...days].filter((d) => d > addDays(day, -14)).sort(),
      };
    });
  }

  addHabit(text: string): Habit {
    const { name, target, schedule } = parseHabit(text);
    if (!name) throw new UserError('A habit needs a name');
    const id = uuid7();
    this.db.tx(() =>
      this.db.insert('habits', {
        id,
        name,
        sort: nextSort(),
        created_at: new Date().toISOString(),
        target_days: target,
        start_date: target ? this.today() : null,
        schedule,
      }),
    );
    return this.db.one<Habit>('SELECT * FROM habits WHERE id = ?', [id])!;
  }

  findHabit(ref: string): Habit {
    const h = this.findByName(this.db.all<Habit>('SELECT * FROM habits ORDER BY sort'), ref);
    if (!h) throw new UserError(`No habit named "${ref}"`, 404);
    return h;
  }

  /** Check a habit in (or out) for a day. Idempotent. */
  checkHabit(ref: string, opts: { day?: string; done?: boolean } = {}) {
    const h = this.findHabit(ref);
    const day = opts.day ? this.date(opts.day, 'day')! : this.today();
    const done = opts.done ?? true;
    const existing = this.db.all<{ id: string }>('SELECT id FROM habit_checks WHERE habit_id = ? AND day = ?', [h.id, day]);
    this.db.tx(() => {
      if (done && !existing.length) this.db.insert('habit_checks', { id: uuid7(), habit_id: h.id, day });
      if (!done) for (const c of existing) this.db.remove('habit_checks', c.id);
    });
    return { ...this.habits(day).find((x) => x.id === h.id)!, day };
  }

  // ---------- time tracking ----------

  timer(): { entry: TimeEntry; task: TaskOut | null; elapsed_min: number } | null {
    const e = this.db.one<TimeEntry>('SELECT * FROM time_entries WHERE end_at IS NULL ORDER BY start_at DESC LIMIT 1');
    if (!e) return null;
    const t = this.db.one<Task>('SELECT * FROM tasks WHERE id = ?', [e.task_id]);
    return { entry: e, task: t ? this.present([t])[0] : null, elapsed_min: Math.round((Date.now() - Date.parse(e.start_at)) / 60_000) };
  }

  /** Start tracking time on a to-do; stops any running timer first (one timer at a time, as in the app). */
  startTimer(taskId: string) {
    const t = this.task(taskId);
    if (t.deleted_at) throw new UserError('That to-do is in the Trash');
    this.db.tx(() => {
      const now = new Date().toISOString();
      for (const e of this.db.all<TimeEntry>('SELECT * FROM time_entries WHERE end_at IS NULL')) this.db.update('time_entries', e.id, { end_at: now });
      this.db.insert('time_entries', { id: uuid7(), task_id: taskId, start_at: now, end_at: null });
    });
    return this.timer()!;
  }

  stopTimer(): { entry: TimeEntry; minutes: number } | null {
    const open = this.db.all<TimeEntry>('SELECT * FROM time_entries WHERE end_at IS NULL ORDER BY start_at DESC');
    if (!open.length) return null;
    const now = new Date().toISOString();
    this.db.tx(() => {
      for (const e of open) this.db.update('time_entries', e.id, { end_at: now });
    });
    const e = { ...open[0], end_at: now };
    return { entry: e, minutes: Math.round((Date.parse(now) - Date.parse(e.start_at)) / 60_000) };
  }
}
