import { SvelteSet } from 'svelte/reactivity';
import * as db from './db';
import { addDays, longLabel, relLabel, today as todayFn } from './dates';
import { nextOccurrence, type Parsed, type When } from './parse';
import * as sound from './sound';
import type {
  Area,
  ChecklistItem,
  DumpSection,
  Habit,
  HabitCheck,
  Heading,
  ID,
  Project,
  Tag,
  Task,
  TaskTag,
  TimeEntry,
  ViewKey,
} from './types';
import * as V from './views';
import { seed } from './seed';
import { sync } from './sync/engine.svelte';
import { installBridge } from './sync/bridge';
import { isTouch } from './env';

export interface Group {
  key: string;
  title?: string;
  subtitle?: string;
  /** For dump sections: the section id (null = unsectioned). */
  sectionId?: ID | null;
  items: Task[];
}

export type Overlay = null | 'quickadd' | 'palette' | 'help';

export type PaletteMode =
  | { kind: 'commands' | 'move' | 'when' | 'deadline' | 'tag' | 'challenge' }
  | { kind: 'prompt'; label: string; placeholder?: string; onSubmit: (value: string) => void };

export const TRASH_DAYS = 30;

function norm(s: string) {
  return s.toLowerCase().replace(/[-_\s]+/g, ' ').trim();
}

class Store {
  ready = $state(false);
  areas = $state<Area[]>([]);
  projects = $state<Project[]>([]);
  headings = $state<Heading[]>([]);
  tasks = $state<Task[]>([]);
  /** Tasks in the Trash, newest first. */
  trashed = $state<Task[]>([]);
  checklist = $state<ChecklistItem[]>([]);
  tags = $state<Tag[]>([]);
  taskTags = $state<TaskTag[]>([]);
  habits = $state<Habit[]>([]);
  habitChecks = $state<HabitCheck[]>([]);
  timeEntries = $state<TimeEntry[]>([]);
  dumpSections = $state<DumpSection[]>([]);
  opCount = $state(0);

  view = $state<ViewKey>({ kind: 'today' });
  selectedId = $state<ID | null>(null);
  expandedId = $state<ID | null>(null);
  /** Tasks checked this session stay visible until you leave the view (like Things). */
  keep = new SvelteSet<ID>();
  /** Ticks every 30s so brain-dump fade and timers update. */
  now = $state(Date.now());
  day = $state(todayFn());

  overlay = $state<Overlay>(null);
  /** Off-canvas list drawer on narrow screens. */
  sidebarOpen = $state(false);
  paletteMode = $state<PaletteMode>({ kind: 'commands' });
  quickAddPrefill = $state('');
  toast = $state<{ text: string; id: number } | null>(null);
  muted = $state(sound.isMuted());

  /** Running time tracking. */
  tracking = $state<{ entryId: ID; taskId: ID; start: number } | null>(null);
  pomodoro = $state<{ endsAt: number; taskId: ID | null } | null>(null);

  // ---------- lifecycle ----------

  async init() {
    const { fresh } = await db.openDb();
    if (fresh) seed();
    this.purgeDump();
    this.purgeTrash();
    this.load();
    sync.onRemoteChanges = () => this.load();
    sync.init();
    installBridge(sync);
    const open = this.timeEntries.find((e) => e.end_at === null);
    if (open) this.tracking = { entryId: open.id, taskId: open.task_id, start: Date.parse(open.start_at) };
    this.ready = true;
    setInterval(() => this.tick(), 1000);
    window.addEventListener('beforeunload', () => void db.saveNow());
  }

  private lastPurge = 0;
  tick() {
    this.now = Date.now();
    const d = todayFn();
    if (d !== this.day) this.day = d;
    if (this.pomodoro && this.now >= this.pomodoro.endsAt) {
      this.pomodoro = null;
      sound.playBell();
      this.notify('Pomodoro done — take a break');
    }
    if (this.now - this.lastPurge > 30_000) {
      this.lastPurge = this.now;
      if (this.purgeDump() || this.purgeTrash()) this.load();
    }
  }

  load() {
    this.areas = db.all<Area>('SELECT * FROM areas ORDER BY sort');
    this.projects = db.all<Project>('SELECT * FROM projects ORDER BY sort');
    this.headings = db.all<Heading>('SELECT * FROM headings ORDER BY sort');
    this.tasks = db.all<Task>('SELECT * FROM tasks WHERE deleted_at IS NULL');
    this.trashed = db.all<Task>('SELECT * FROM tasks WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC');
    this.checklist = db.all<ChecklistItem>('SELECT * FROM checklist ORDER BY sort');
    this.tags = db.all<Tag>('SELECT * FROM tags ORDER BY name');
    this.taskTags = db.all<TaskTag>('SELECT * FROM task_tags');
    this.habits = db.all<Habit>('SELECT * FROM habits ORDER BY sort');
    this.habitChecks = db.all<HabitCheck>('SELECT * FROM habit_checks');
    this.timeEntries = db.all<TimeEntry>('SELECT * FROM time_entries');
    this.dumpSections = db.all<DumpSection>('SELECT * FROM dump_sections ORDER BY sort');
    this.opCount = db.opCount();
  }

  /** Unchecked brain-dump items older than 48h are deleted for good. Returns true if any were removed. */
  purgeDump(): boolean {
    const now = Date.now();
    const expired = db.all<Task>('SELECT * FROM tasks WHERE dump = 1 AND completed_at IS NULL').filter((t) => V.isDumpExpired(t, now));
    for (const t of expired) this.hardDelete(t.id);
    return expired.length > 0;
  }

  /** Trashed tasks older than 30 days are deleted for good. */
  purgeTrash(): boolean {
    const cutoff = new Date(Date.now() - TRASH_DAYS * 86_400_000).toISOString();
    const old = db.all<{ id: string }>('SELECT id FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?', [cutoff]);
    for (const t of old) this.hardDelete(t.id);
    return old.length > 0;
  }

  notify(text: string) {
    const id = Date.now();
    this.toast = { text, id };
    setTimeout(() => {
      if (this.toast?.id === id) this.toast = null;
    }, 2600);
  }

  // ---------- navigation ----------

  go(v: ViewKey) {
    this.view = v;
    this.sidebarOpen = false;
    this.keep.clear();
    this.expandedId = null;
    this.selectedId = isTouch ? null : (this.selectable[0] ?? null);
  }

  isView(v: ViewKey) {
    if (v.kind !== this.view.kind) return false;
    if ('id' in v && 'id' in this.view) return v.id === this.view.id;
    return true;
  }

  get viewTitle(): string {
    const v = this.view;
    switch (v.kind) {
      case 'inbox': return 'Inbox';
      case 'today': return 'Today';
      case 'upcoming': return 'Upcoming';
      case 'anytime': return 'Anytime';
      case 'someday': return 'Someday';
      case 'logbook': return 'Logbook';
      case 'dump': return 'Brain Dump';
      case 'habits': return 'Habits';
      case 'matrix': return 'Matrix';
      case 'trash': return 'Trash';
      case 'settings': return 'Settings';
      case 'project': return this.projects.find((p) => p.id === v.id)?.name ?? 'Project';
      case 'area': return this.areas.find((a) => a.id === v.id)?.name ?? 'Area';
    }
  }

  // ---------- derived lists ----------

  groups: Group[] = $derived.by(() => this.computeGroups());

  selectable: ID[] = $derived.by(() => {
    if (this.view.kind === 'habits') return this.habits.map((h) => h.id);
    if (this.view.kind === 'trash') return this.trashed.map((t) => t.id);
    return this.groups.flatMap((g) => g.items.map((t) => t.id));
  });

  private groupByContainer(items: Task[]): Group[] {
    const loose = items.filter((t) => !t.project_id);
    const out: Group[] = [];
    if (loose.length) out.push({ key: 'loose', items: loose });
    for (const p of this.projects) {
      const ps = items.filter((t) => t.project_id === p.id);
      if (ps.length) out.push({ key: p.id, title: p.name, items: ps });
    }
    return out;
  }

  private computeGroups(): Group[] {
    const v = this.view;
    const ts = this.tasks;
    const keep = this.keep;
    const day = this.day;
    switch (v.kind) {
      case 'inbox':
        return [{ key: 'inbox', items: V.inbox(ts, keep) }];
      case 'today': {
        const t = V.todayView(ts, day, keep);
        const out: Group[] = [{ key: 'today', items: t.day }];
        if (t.evening.length) out.push({ key: 'evening', title: 'This Evening', items: t.evening });
        return out;
      }
      case 'upcoming':
        return V.upcoming(ts, day, keep).map((g) => ({
          key: g.date,
          title: relLabel(g.date, day),
          subtitle: longLabel(g.date),
          items: g.tasks,
        }));
      case 'anytime':
        return this.groupByContainer(V.anytime(ts, day, keep));
      case 'someday':
        return this.groupByContainer(V.someday(ts, keep));
      case 'logbook': {
        const items = V.logbook(ts);
        const out: Group[] = [];
        for (const t of items) {
          const d = t.completed_at!.slice(0, 10);
          const key = d;
          let g = out.find((x) => x.key === key);
          if (!g) out.push((g = { key, title: relLabel(d, day), items: [] }));
          g.items.push(t);
        }
        return out;
      }
      case 'dump': {
        const items = V.dump(ts, keep, this.now);
        const out: Group[] = [{ key: 'dump-loose', sectionId: null, items: items.filter((t) => !t.dump_section_id) }];
        for (const s of this.dumpSections) {
          out.push({ key: s.id, title: s.name, sectionId: s.id, items: items.filter((t) => t.dump_section_id === s.id) });
        }
        return out;
      }
      case 'matrix': {
        const m = V.matrix(ts, keep);
        return [
          { key: 'do', title: 'Do', subtitle: 'Urgent · Important', items: m.do },
          { key: 'schedule', title: 'Schedule', subtitle: 'Important', items: m.schedule },
          { key: 'delegate', title: 'Delegate', subtitle: 'Urgent', items: m.delegate },
          { key: 'drop', title: 'Drop', subtitle: 'Neither', items: m.drop },
        ];
      }
      case 'project': {
        const items = ts.filter((t) => t.project_id === v.id && !t.dump && (t.completed_at === null || keep.has(t.id))).sort((a, b) => a.sort - b.sort);
        const out: Group[] = [{ key: 'p-loose', items: items.filter((t) => !t.heading_id) }];
        for (const h of this.headings.filter((h) => h.project_id === v.id)) {
          out.push({ key: h.id, title: h.name, items: items.filter((t) => t.heading_id === h.id) });
        }
        return out;
      }
      case 'area': {
        const projIds = new Set(this.projects.filter((p) => p.area_id === v.id).map((p) => p.id));
        const items = ts
          .filter((t) => !t.dump && (t.completed_at === null || keep.has(t.id)) && (t.area_id === v.id || (t.project_id && projIds.has(t.project_id))))
          .sort((a, b) => a.sort - b.sort);
        return this.groupByContainer(items);
      }
      case 'habits':
      case 'settings':
        return [];
      case 'trash':
        return [];
    }
  }

  // ---------- lookups ----------

  task(id: ID | null) {
    return id ? this.tasks.find((t) => t.id === id) : undefined;
  }
  tagsFor(id: ID): Tag[] {
    const ids = new Set(this.taskTags.filter((tt) => tt.task_id === id).map((tt) => tt.tag_id));
    return this.tags.filter((t) => ids.has(t.id));
  }
  checklistFor(id: ID) {
    return this.checklist.filter((c) => c.task_id === id);
  }
  containerName(t: Task): string | null {
    if (t.project_id) return this.projects.find((p) => p.id === t.project_id)?.name ?? null;
    if (t.area_id) return this.areas.find((a) => a.id === t.area_id)?.name ?? null;
    return null;
  }
  trackedMs(taskId: ID): number {
    let ms = 0;
    for (const e of this.timeEntries) {
      if (e.task_id !== taskId) continue;
      const end = e.end_at ? Date.parse(e.end_at) : this.now;
      ms += end - Date.parse(e.start_at);
    }
    return ms;
  }
  openCount(v: ViewKey): number {
    const ts = this.tasks;
    const none = new Set<string>();
    switch (v.kind) {
      case 'inbox': return V.inbox(ts, none).length;
      case 'today': {
        const t = V.todayView(ts, this.day, none);
        return t.day.length + t.evening.length;
      }
      case 'dump': return V.dump(ts, none, this.now).length;
      case 'trash': return this.trashed.length;
      case 'project': return ts.filter((t) => t.project_id === v.id && !t.completed_at).length;
      default: return 0;
    }
  }
  projectProgress(id: ID): number {
    const ts = this.tasks.filter((t) => t.project_id === id);
    if (!ts.length) return 0;
    return ts.filter((t) => t.completed_at).length / ts.length;
  }

  // ---------- task writes ----------

  private nextSort(): number {
    return Date.now() / 1000;
  }

  /** Find-or-create a project or area by name; returns placement fields. */
  private resolveContainer(name: string): { project_id: ID | null; area_id: ID | null } {
    const n = norm(name);
    const p = this.projects.find((x) => norm(x.name) === n) ?? this.projects.find((x) => norm(x.name).startsWith(n));
    if (p) return { project_id: p.id, area_id: null };
    const a = this.areas.find((x) => norm(x.name) === n) ?? this.areas.find((x) => norm(x.name).startsWith(n));
    if (a) return { project_id: null, area_id: a.id };
    const id = db.uuid7();
    db.insert('projects', { id, area_id: null, name: name, notes: '', sort: this.nextSort(), completed_at: null });
    this.notify(`Created project “${name}”`);
    return { project_id: id, area_id: null };
  }

  private tagId(name: string): ID {
    const existing = db.one<Tag>('SELECT * FROM tags WHERE lower(name) = lower(?)', [name]);
    if (existing) return existing.id;
    const id = db.uuid7();
    db.insert('tags', { id, name });
    return id;
  }

  private dumpSectionId(name: string): ID {
    const n = norm(name);
    const s = db.all<DumpSection>('SELECT * FROM dump_sections').find((x) => norm(x.name) === n);
    if (s) return s.id;
    const id = db.uuid7();
    db.insert('dump_sections', { id, name, sort: this.nextSort() });
    return id;
  }

  /** Placement implied by the current view, used when quick add has no explicit target. */
  private contextDefaults(): Partial<Task> {
    const v = this.view;
    switch (v.kind) {
      case 'today': return { when_date: this.day };
      case 'someday': return { someday: 1 };
      case 'project': return { project_id: v.id };
      case 'area': return { area_id: v.id };
      case 'dump': return { dump: 1 };
      default: return {};
    }
  }

  addParsed(p: Parsed, opts: { useContext: boolean } = { useContext: true }): ID | null {
    if (!p.title) return null;
    const id = db.uuid7();
    const row: Task = {
      id,
      title: p.title,
      notes: p.notes,
      project_id: null,
      area_id: null,
      heading_id: null,
      when_date: null,
      evening: 0,
      someday: 0,
      deadline: p.deadline,
      completed_at: null,
      created_at: new Date().toISOString(),
      sort: this.nextSort(),
      urgent: p.urgent ? 1 : 0,
      important: p.important ? 1 : 0,
      estimate_min: p.estimateMin,
      rrule: p.rrule,
      dump: 0,
      dump_section_id: null,
      deleted_at: null,
    };
    const explicit = p.project || p.when || p.dump;
    if (opts.useContext && !explicit) Object.assign(row, this.contextDefaults());
    if (p.project) Object.assign(row, this.resolveContainer(p.project));
    if (p.when) {
      row.when_date = p.when.date;
      row.evening = p.when.evening ? 1 : 0;
      row.someday = p.when.someday ? 1 : 0;
    }
    if (p.dump) {
      row.dump = 1;
      row.dump_section_id = p.dumpSection ? this.dumpSectionId(p.dumpSection) : null;
    } else if (row.dump && this.view.kind === 'dump') {
      // Adding from inside a dump section keeps it there.
      const sel = this.task(this.selectedId);
      row.dump_section_id = sel?.dump ? sel.dump_section_id : null;
    }
    db.insert('tasks', row as unknown as db.Row & { id: string });
    for (const name of p.tags) db.insert('task_tags', { id: db.uuid7(), task_id: id, tag_id: this.tagId(name) });
    this.load();
    return id;
  }

  update(id: ID, fields: Partial<Task>) {
    db.update('tasks', id, fields as db.Row);
    this.load();
  }

  toggleComplete(id: ID) {
    const t = this.task(id);
    if (!t) return;
    if (t.completed_at) {
      db.update('tasks', id, { completed_at: null });
      this.keep.delete(id);
      sound.playUncheck();
    } else {
      db.update('tasks', id, { completed_at: new Date().toISOString() });
      this.keep.add(id);
      if (t.dump) sound.playScratch();
      else sound.playComplete();
      if (this.tracking?.taskId === id) this.stopTracking();
      if (t.rrule) {
        const from = t.when_date && t.when_date > this.day ? t.when_date : this.day;
        const next = nextOccurrence(t.rrule, from);
        const nid = db.uuid7();
        db.insert('tasks', {
          ...(t as unknown as db.Row),
          id: nid,
          when_date: next,
          evening: t.evening,
          completed_at: null,
          created_at: new Date().toISOString(),
        });
        for (const tt of this.taskTags.filter((x) => x.task_id === id)) db.insert('task_tags', { id: db.uuid7(), task_id: nid, tag_id: tt.tag_id });
        for (const c of this.checklistFor(id)) db.insert('checklist', { id: db.uuid7(), task_id: nid, title: c.title, done: 0, sort: c.sort });
        this.notify(`Next: ${relLabel(next, this.day)}`);
      }
    }
    this.load();
  }

  setWhen(id: ID, w: When) {
    this.update(id, {
      when_date: w.date,
      evening: w.evening ? 1 : 0,
      someday: w.someday ? 1 : 0,
      ...(w.inbox ? { project_id: null, area_id: null, heading_id: null } : {}),
    });
  }

  setToday(id: ID) {
    this.setWhen(id, { date: this.day, evening: false, someday: false, inbox: false });
  }
  setEvening(id: ID) {
    this.setWhen(id, { date: this.day, evening: true, someday: false, inbox: false });
  }
  setSomeday(id: ID) {
    this.setWhen(id, { date: null, evening: false, someday: true, inbox: false });
  }
  setTomorrow(id: ID) {
    this.setWhen(id, { date: addDays(this.day, 1), evening: false, someday: false, inbox: false });
  }

  moveTo(id: ID, target: { project_id?: ID | null; area_id?: ID | null; inbox?: boolean }) {
    const t = this.task(id);
    if (!t) return;
    const fields: Partial<Task> = {
      project_id: target.project_id ?? null,
      area_id: target.area_id ?? null,
      heading_id: null,
    };
    // Leaving the brain dump makes it a normal, permanent task.
    if (t.dump) {
      fields.dump = 0;
      fields.dump_section_id = null;
    }
    this.update(id, fields);
  }

  moveToDumpSection(id: ID, sectionId: ID | null) {
    this.update(id, { dump: 1, dump_section_id: sectionId });
  }

  toggleUrgent(id: ID) {
    const t = this.task(id);
    if (t) this.update(id, { urgent: t.urgent ? 0 : 1 });
  }
  toggleImportant(id: ID) {
    const t = this.task(id);
    if (t) this.update(id, { important: t.important ? 0 : 1 });
  }

  addTag(id: ID, name: string) {
    const tagId = this.tagId(name);
    if (!this.taskTags.some((tt) => tt.task_id === id && tt.tag_id === tagId)) db.insert('task_tags', { id: db.uuid7(), task_id: id, tag_id: tagId });
    this.load();
  }

  removeTag(id: ID, tagId: ID) {
    for (const tt of this.taskTags.filter((x) => x.task_id === id && x.tag_id === tagId)) db.remove('task_tags', tt.id);
    this.load();
  }

  private hardDelete(id: ID) {
    for (const tt of db.all<TaskTag>('SELECT * FROM task_tags WHERE task_id = ?', [id])) db.remove('task_tags', tt.id);
    for (const c of db.all<ChecklistItem>('SELECT * FROM checklist WHERE task_id = ?', [id])) db.remove('checklist', c.id);
    db.remove('tasks', id);
  }

  /** Move a task to the Trash. It can be restored for 30 days. */
  deleteTask(id: ID) {
    const idx = this.selectable.indexOf(id);
    if (this.tracking?.taskId === id) this.stopTracking();
    db.update('tasks', id, { deleted_at: new Date().toISOString() });
    this.keep.delete(id);
    this.load();
    this.selectedId = this.selectable[Math.min(idx, this.selectable.length - 1)] ?? null;
    if (this.expandedId === id) this.expandedId = null;
    this.notify('Moved to Trash');
  }

  restoreTask(id: ID) {
    const idx = this.selectable.indexOf(id);
    db.update('tasks', id, { deleted_at: null });
    this.load();
    if (this.view.kind === 'trash') this.selectedId = this.selectable[Math.min(idx, this.selectable.length - 1)] ?? null;
    this.notify('Restored');
  }

  purgeTask(id: ID) {
    const idx = this.selectable.indexOf(id);
    this.hardDelete(id);
    this.load();
    this.selectedId = this.selectable[Math.min(idx, this.selectable.length - 1)] ?? null;
  }

  emptyTrash() {
    for (const t of this.trashed) this.hardDelete(t.id);
    this.load();
    this.selectedId = null;
    this.notify('Trash emptied');
  }

  /** Move a task up/down within its group by swapping sort keys with its neighbour. */
  reorder(id: ID, dir: -1 | 1) {
    const g = this.groups.find((g) => g.items.some((t) => t.id === id));
    if (!g) return;
    const i = g.items.findIndex((t) => t.id === id);
    const j = i + dir;
    if (j < 0 || j >= g.items.length) return;
    const a = g.items[i];
    const b = g.items[j];
    // Fractional index: place between b and the item beyond it.
    const beyond = g.items[j + dir];
    const sort = beyond ? (b.sort + beyond.sort) / 2 : b.sort + dir;
    db.update('tasks', a.id, { sort });
    this.load();
  }

  addChecklist(taskId: ID, title: string) {
    if (!title.trim()) return;
    db.insert('checklist', { id: db.uuid7(), task_id: taskId, title: title.trim(), done: 0, sort: this.nextSort() });
    this.load();
  }
  toggleChecklist(id: ID) {
    const c = this.checklist.find((x) => x.id === id);
    if (!c) return;
    db.update('checklist', id, { done: c.done ? 0 : 1 });
    if (!c.done) sound.playUncheck();
    this.load();
  }
  removeChecklist(id: ID) {
    db.remove('checklist', id);
    this.load();
  }

  // ---------- projects / areas / sections ----------

  addProject(name: string, areaId: ID | null = null): ID {
    const id = db.uuid7();
    db.insert('projects', { id, area_id: areaId, name, notes: '', sort: this.nextSort(), completed_at: null });
    this.load();
    return id;
  }
  addArea(name: string): ID {
    const id = db.uuid7();
    db.insert('areas', { id, name, sort: this.nextSort() });
    this.load();
    return id;
  }
  addHeading(projectId: ID, name: string) {
    db.insert('headings', { id: db.uuid7(), project_id: projectId, name, sort: this.nextSort() });
    this.load();
  }
  addDumpSection(name: string) {
    this.dumpSectionId(name);
    this.load();
  }
  completeProject(id: ID) {
    const p = this.projects.find((x) => x.id === id);
    if (!p) return;
    db.update('projects', id, { completed_at: p.completed_at ? null : new Date().toISOString() });
    sound.playComplete();
    this.load();
  }

  // ---------- habits ----------

  /** "Cold shower 75d" creates a 75-day challenge starting today. */
  addHabit(input: string) {
    const m = /^(.*?)\s+(\d{1,3})\s*d(?:ays?)?$/i.exec(input.trim());
    const name = m ? m[1] : input.trim();
    const target = m ? Number(m[2]) : null;
    db.insert('habits', {
      id: db.uuid7(),
      name,
      sort: this.nextSort(),
      created_at: new Date().toISOString(),
      target_days: target,
      start_date: target ? this.day : null,
    });
    this.load();
  }

  /** Set a challenge length (null = open-ended). Starting a new length restarts from today. */
  setChallenge(id: ID, days: number | null, restart = true) {
    const h = this.habits.find((x) => x.id === id);
    if (!h) return;
    db.update('habits', id, {
      target_days: days,
      start_date: days ? (restart || !h.start_date ? this.day : h.start_date) : null,
    });
    this.load();
    this.notify(days ? `${days}-day challenge starts ${restart || !h.start_date ? 'today' : h.start_date}` : 'Challenge removed');
  }
  habitDays(id: ID): Set<string> {
    return new Set(this.habitChecks.filter((c) => c.habit_id === id).map((c) => c.day));
  }
  toggleHabit(id: ID, day: string = this.day) {
    const existing = db.one<{ id: string }>('SELECT id FROM habit_checks WHERE habit_id = ? AND day = ?', [id, day]);
    if (existing) {
      db.remove('habit_checks', existing.id);
      sound.playUncheck();
    } else {
      db.insert('habit_checks', { id: db.uuid7(), habit_id: id, day });
      sound.playHabit();
    }
    this.load();
  }
  deleteHabit(id: ID) {
    for (const c of db.all<{ id: string }>('SELECT id FROM habit_checks WHERE habit_id = ?', [id])) db.remove('habit_checks', c.id);
    db.remove('habits', id);
    this.load();
    this.selectedId = this.selectable[0] ?? null;
  }

  // ---------- time tracking ----------

  startTracking(taskId: ID) {
    if (this.tracking) this.stopTracking();
    const entryId = db.uuid7();
    const start = new Date();
    db.insert('time_entries', { id: entryId, task_id: taskId, start_at: start.toISOString(), end_at: null });
    this.tracking = { entryId, taskId, start: start.getTime() };
    this.load();
  }
  stopTracking() {
    if (!this.tracking) return;
    db.update('time_entries', this.tracking.entryId, { end_at: new Date().toISOString() });
    this.tracking = null;
    this.load();
  }
  toggleTracking(taskId: ID) {
    if (this.tracking?.taskId === taskId) this.stopTracking();
    else this.startTracking(taskId);
  }
  startPomodoro(taskId: ID | null, minutes = 25) {
    this.pomodoro = { endsAt: Date.now() + minutes * 60_000, taskId };
    if (taskId) this.startTracking(taskId);
    this.notify(`Pomodoro: ${minutes} minutes`);
  }
  cancelPomodoro() {
    this.pomodoro = null;
  }

  // ---------- misc ----------

  toggleMute() {
    this.muted = !this.muted;
    sound.setMuted(this.muted);
    if (!this.muted) sound.playComplete();
    this.notify(this.muted ? 'Sounds off' : 'Sounds on');
  }

  async resetDemo() {
    await db.resetDb();
    location.reload();
  }

  exportJson() {
    const blob = new Blob([db.exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `openthings-${this.day}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

export const store = new Store();
