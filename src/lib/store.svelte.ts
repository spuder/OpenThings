import { SvelteSet } from 'svelte/reactivity';
import * as db from './db';
import { addDays, longLabel, relLabel, shiftReminder, today as todayFn } from './dates';
import { describeRule, firstOccurrence, nextRepeat, parseHabit, type Parsed, type When } from './parse';
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
import { mergeTags } from './schema';
import { sync } from './sync/engine.svelte';
import { installBridge } from './sync/bridge';
import { isTouch } from './env';
import { isNativeShell } from './native/shell';
import { dueReminders, notifier, upcomingReminders } from './reminders.svelte';
import { reminderLabel } from './parse';
import { previousValues, UndoStack } from './undo';
import * as Sel from './selection';
import { features, viewEnabled, type FeatureId } from './features.svelte';
import { mergeImportedTags, type ThingsImport } from './import/things';

export interface Group {
  key: string;
  title?: string;
  subtitle?: string;
  /** For dump sections: the section id (null = unsectioned). */
  sectionId?: ID | null;
  items: Task[];
}

export type Overlay = null | 'quickadd' | 'palette' | 'help' | 'focus' | 'find' | 'themes' | 'repeat';

export interface FocusSession {
  taskId: ID;
  phase: 'work' | 'break';
  /** Length of the current phase in minutes. */
  minutes: number;
  /** Wall-clock end while running; null while paused or not started. */
  endsAt: number | null;
  /** Time left while paused. */
  remainingMs: number;
  /** Completed work sessions in this sitting. */
  sessions: number;
}

export type PaletteMode =
  | { kind: 'commands' | 'move' | 'when' | 'deadline' | 'tag' | 'challenge' | 'reminder' | 'schedule' }
  | { kind: 'prompt'; label: string; placeholder?: string; initial?: string; onSubmit: (value: string) => void }
  | { kind: 'choose'; label: string; options: { label: string; hint?: string; run: () => void }[] };

export const TRASH_DAYS = 30;

function loadRecent(): ViewKey[] {
  try {
    const v = JSON.parse(localStorage.getItem('openthings.recent') ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function norm(s: string) {
  return s.toLowerCase().replace(/[-_\s]+/g, ' ').trim();
}

/** Top-level lists a to-do can be moved to directly (see `moveToList`). */
export type MoveList = 'inbox' | 'today' | 'anytime' | 'someday' | 'dump';

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
  /** The row the keyboard is on (and the one single-item actions use). */
  selectedId = $state<ID | null>(null);
  expandedId = $state<ID | null>(null);
  /**
   * Multi-selection (Shift / ⌘ click, Shift+arrows, long-press on touch). Only meaningful while
   * `isMulti`; otherwise the selection is just `selectedId`. Its cursor is kept equal to `selectedId`.
   */
  multi = $state<Sel.Selection>(Sel.EMPTY);
  /** Selection mode: taps and clicks toggle rows instead of opening them (touch, or V). */
  selecting = $state(false);
  /** Tasks checked this session stay visible until you leave the view (like Things). */
  keep = new SvelteSet<ID>();
  /** Ticks every 30s so brain-dump fade and timers update. */
  now = $state(Date.now());
  day = $state(todayFn());

  overlay = $state<Overlay>(null);
  /** Off-canvas list drawer on narrow screens. */
  sidebarOpen = $state(false);
  /** Sidebar hidden on wide screens (Ctrl/⌘ /). Per device. */
  sidebarHidden = $state((() => {
    try {
      return localStorage.getItem('openthings.sidebarHidden') === '1';
    } catch {
      return false;
    }
  })());

  toggleSidebar() {
    if (typeof matchMedia !== 'undefined' && matchMedia('(max-width: 760px)').matches) {
      this.sidebarOpen = !this.sidebarOpen;
      return;
    }
    this.sidebarHidden = !this.sidebarHidden;
    try {
      localStorage.setItem('openthings.sidebarHidden', this.sidebarHidden ? '1' : '0');
    } catch {
      /* ignore */
    }
  }
  paletteMode = $state<PaletteMode>({ kind: 'commands' });
  quickAddPrefill = $state('');
  toast = $state<{ text: string; id: number } | null>(null);
  muted = $state(sound.isMuted());

  /** Running time tracking. */
  tracking = $state<{ entryId: ID; taskId: ID; start: number } | null>(null);
  pomodoro = $state<{ endsAt: number; taskId: ID | null } | null>(null);
  /** Focus mode (F): a Pomodoro bound to one to-do. Keeps running when the focus screen is closed. */
  focus = $state<FocusSession | null>(null);
  focusWorkMinutes = $state(25);

  // ---------- lifecycle ----------

  async init() {
    await db.openDb();
    this.purgeDump();
    this.purgeTrash();
    this.load();
    sync.onRemoteChanges = () => this.load();
    sync.init();
    installBridge(sync, () => upcomingReminders(this.tasks, Date.now()));
    if (isNativeShell()) {
      // iOS/Android (Capacitor): OS notifications, widgets snapshot, share/Shortcuts import. Not loaded on the web.
      try {
        const native = await import('./native/capacitor.svelte');
        await native.startNative(this);
      } catch (e) {
        console.error('Native shell init failed', e);
      }
    }
    void notifier.init((id) => this.reveal(id));
    const fromNotification = new URLSearchParams(location.search).get('task');
    if (fromNotification) {
      history.replaceState(null, '', location.pathname);
      this.reveal(fromNotification);
    }
    this.ready = true;
    setInterval(() => this.tick(), 1000);
    window.addEventListener('beforeunload', () => void db.saveNow());
  }

  private lastPurge = 0;
  private lastReminderCheck = 0;
  tick() {
    this.now = Date.now();
    const d = todayFn();
    if (d !== this.day) this.day = d;
    if (this.focus?.endsAt && this.now >= this.focus.endsAt) this.finishFocusPhase();
    if (this.pomodoro && this.now >= this.pomodoro.endsAt) {
      this.pomodoro = null;
      sound.playBell();
      this.notify('Pomodoro done — take a break');
    }
    if (this.now - this.lastReminderCheck > 5_000) {
      this.lastReminderCheck = this.now;
      this.fireDueReminders();
    }
    if (this.now - this.lastPurge > 30_000) {
      this.lastPurge = this.now;
      if (this.purgeDump() || this.purgeTrash()) this.load();
    }
  }

  /** While > 0, load() is postponed so a bulk action reloads once at the end. */
  private deferLoad = 0;
  private loadPending = false;

  load() {
    if (this.deferLoad) {
      this.loadPending = true;
      return;
    }
    this.loadPending = false;
    this.areas = db.all<Area>('SELECT * FROM areas ORDER BY sort');
    this.projects = db.all<Project>('SELECT * FROM projects ORDER BY sort');
    this.headings = db.all<Heading>('SELECT * FROM headings ORDER BY sort');
    this.tasks = db.all<Task>('SELECT * FROM tasks WHERE deleted_at IS NULL');
    this.trashed = db.all<Task>('SELECT * FROM tasks WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC');
    this.checklist = db.all<ChecklistItem>('SELECT * FROM checklist ORDER BY sort');
    // Same-named tags from different devices show as one.
    const tags = mergeTags(db.all<Tag>('SELECT * FROM tags ORDER BY name'), db.all<TaskTag>('SELECT * FROM task_tags'));
    this.tags = tags.tags;
    this.taskTags = tags.links;
    this.habits = db.all<Habit>('SELECT * FROM habits ORDER BY sort');
    this.habitChecks = db.all<HabitCheck>('SELECT * FROM habit_checks');
    this.timeEntries = db.all<TimeEntry>('SELECT * FROM time_entries');
    // Running timer: may have been started or stopped on another device, the REST API or MCP.
    const open = this.timeEntries.filter((e) => e.end_at === null).sort((a, b) => b.start_at.localeCompare(a.start_at))[0];
    this.tracking = open ? { entryId: open.id, taskId: open.task_id, start: Date.parse(open.start_at) } : null;
    this.dumpSections = db.all<DumpSection>('SELECT * FROM dump_sections ORDER BY sort');
    this.opCount = db.opCount();
    this.announceReminders();
  }

  private reminderSig = '';
  /** Tell native shells when the set of pending reminders changes, so they can reschedule. */
  private announceReminders() {
    if (typeof window === 'undefined') return;
    const list = upcomingReminders(this.tasks, Date.now());
    const sig = list.map((r) => `${r.taskId}@${r.at}`).join('|');
    if (sig === this.reminderSig) return;
    this.reminderSig = sig;
    window.dispatchEvent(new CustomEvent('openthings:reminders', { detail: list }));
  }

  /**
   * Unchecked brain-dump items older than 48h are deleted for good, and sections whose last to-do
   * has expired with them. Returns true if anything was removed.
   */
  purgeDump(): boolean {
    const now = Date.now();
    const expired = db.all<Task>('SELECT * FROM tasks WHERE dump = 1 AND completed_at IS NULL').filter((t) => V.isDumpExpired(t, now));
    for (const t of expired) this.hardDelete(t.id);
    const justExpired = new Set(expired.map((t) => t.dump_section_id).filter((id): id is ID => !!id));
    const named = db.all<Task>('SELECT * FROM tasks WHERE dump_section_id IS NOT NULL');
    const gone = V.expiredDumpSections(db.all<DumpSection>('SELECT * FROM dump_sections'), named, justExpired, now);
    for (const s of gone) db.remove('dump_sections', s.id);
    return expired.length > 0 || gone.length > 0;
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

  // ---------- undo ----------

  /** Undo steps for to-do changes (⌘Z / Ctrl+Z outside text fields). Per session, not synced. */
  private undoStack = new UndoStack();

  undo() {
    const label = this.undoStack.undo();
    if (!label) return this.notify('Nothing to undo');
    this.load();
    this.notify(`Undid ${label}`);
  }

  // ---------- navigation ----------

  /** Recently visited lists, newest first (Quick Find shows these before you type). Per device. */
  recentViews = $state<ViewKey[]>(loadRecent());

  go(v: ViewKey) {
    if (!viewEnabled(v.kind)) v = { kind: 'today' };
    this.view = v;
    if (v.kind !== 'settings') {
      const key = JSON.stringify(v);
      this.recentViews = [v, ...this.recentViews.filter((r) => JSON.stringify(r) !== key)].slice(0, 6);
      try {
        localStorage.setItem('openthings.recent', JSON.stringify(this.recentViews));
      } catch {
        /* ignore */
      }
    }
    this.sidebarOpen = false;
    this.keep.clear();
    this.expandedId = null;
    this.clearMulti();
    this.selectedId = isTouch ? null : (this.selectable[0] ?? null);
  }

  /** Turn an optional feature on or off; leaves its view if you're in it. */
  setFeature(id: FeatureId, on: boolean) {
    features.set(id, on);
    if (!on && !viewEnabled(this.view.kind)) this.go({ kind: 'today' });
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
      case 'week': return 'This Week';
      case 'upcoming': return 'Upcoming';
      case 'anytime': return 'Anytime';
      case 'someday': return 'Someday';
      case 'logbook': return 'Logbook';
      case 'dump': return 'Brain Dump';
      case 'habits': return 'Habits';
      case 'matrix': return 'Matrix';
      case 'trash': return 'Trash';
      case 'tag': return `#${this.tags.find((t) => t.id === v.id)?.name ?? 'tag'}`;
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

  // ---------- multi-selection ----------

  /** More than one row is selected, or selection mode is on. */
  get isMulti(): boolean {
    return this.selecting || this.multi.ids.length > 1;
  }

  /** The to-dos an action applies to: the multi-selection, else the selected row. */
  get actionIds(): ID[] {
    if (this.isMulti) return Sel.inOrder(this.multi.ids, this.selectable);
    return this.selectedId ? [this.selectedId] : [];
  }

  isPicked(id: ID): boolean {
    return this.isMulti ? this.multi.ids.includes(id) : this.selectedId === id;
  }

  /** Multi-selection lists only to-dos; Habits, Trash and Brain Dump keep single selection. */
  get canMulti(): boolean {
    return !['habits', 'trash', 'dump', 'settings'].includes(this.view.kind);
  }

  /** The current selection as a Selection, whether or not it's multi. */
  private currentSel(): Sel.Selection {
    if (this.isMulti) return this.multi;
    return this.selectedId ? Sel.selectOnly(this.selectedId) : Sel.EMPTY;
  }

  private setSel(next: Sel.Selection) {
    this.multi = next;
    this.selectedId = next.cursor;
    if (next.ids.length > 1 || this.selecting) this.expandedId = null;
  }

  clearMulti() {
    this.multi = Sel.EMPTY;
    this.selecting = false;
  }

  /** Shift click: select from the anchor to this row. */
  selectRange(id: ID) {
    if (!this.canMulti) return;
    this.setSel(Sel.range(this.currentSel(), id, this.selectable));
  }

  /** ⌘/Ctrl click, or a tap in selection mode: add or remove one row. */
  toggleSelect(id: ID) {
    if (!this.canMulti) return;
    const next = Sel.toggle(this.currentSel(), id, this.selectable);
    this.setSel(next);
    // Outside selection mode, one row left is an ordinary single selection.
    if (!this.selecting && next.ids.length <= 1) this.multi = Sel.EMPTY;
  }

  /** Shift+↑ / Shift+↓. */
  extendSelection(delta: number) {
    if (!this.canMulti) return;
    this.setSel(Sel.extend(this.currentSel(), delta, this.selectable));
  }

  selectAll() {
    if (!this.canMulti) return;
    this.setSel(Sel.selectAll(this.selectable, this.selectedId));
  }

  /** Enter selection mode (long-press on touch, V on a keyboard), optionally picking a first row. */
  startSelecting(id: ID | null = this.selectedId) {
    if (!this.canMulti) return;
    const base = this.currentSel();
    this.selecting = true;
    this.setSel(id && !base.ids.includes(id) ? Sel.toggle(base, id, this.selectable) : base);
  }

  /** After a bulk action: forget rows that left the list; leave multi mode when nothing is left. */
  private pruneSelection() {
    if (!this.isMulti) return;
    const next = Sel.prune(this.multi, this.selectable);
    if (!next.ids.length && !this.selecting) return this.clearMulti();
    this.multi = next;
    this.selectedId = next.cursor;
    if (next.ids.length <= 1 && !this.selecting) this.multi = Sel.EMPTY;
  }

  /** Run several writes as one undo step with one reload. */
  bulk(label: string, fn: () => void) {
    this.deferLoad++;
    try {
      this.undoStack.group(label, fn);
    } finally {
      this.deferLoad--;
      // Always reload: some actions (Move to Trash) write without calling load() themselves.
      if (!this.deferLoad) this.load();
    }
    this.pruneSelection();
  }

  /** Apply a single-item action to each id, as one undo step. */
  each(ids: ID[], label: string, fn: (id: ID) => void) {
    if (ids.length === 1) {
      fn(ids[0]);
      this.pruneSelection();
      return;
    }
    this.bulk(label, () => ids.forEach(fn));
  }

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
      case 'week':
        return V.thisWeek(ts, day, keep).map((g) => ({
          key: g.date,
          title: relLabel(g.date, day),
          subtitle: longLabel(g.date),
          items: g.tasks,
        }));
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
        const g = V.dumpGroups(this.dumpSections, items);
        return [
          { key: 'dump-loose', sectionId: null, items: g.loose },
          ...g.sections.map(({ section: s, items }) => ({ key: s.id, title: s.name, sectionId: s.id, items })),
        ];
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
      case 'tag': {
        const ids = new Set(this.taskTags.filter((tt) => tt.tag_id === v.id).map((tt) => tt.task_id));
        const items = ts.filter((t) => ids.has(t.id) && (t.completed_at === null || keep.has(t.id))).sort((a, b) => a.sort - b.sort);
        return this.groupByContainer(items);
      }
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
      case 'area': {
        const projIds = new Set(this.projects.filter((p) => p.area_id === v.id).map((p) => p.id));
        return ts.filter((t) => !t.completed_at && !t.dump && (t.area_id === v.id || (t.project_id && projIds.has(t.project_id)))).length;
      }
      case 'anytime': return V.anytime(ts, this.day, none).length;
      case 'upcoming': return V.upcoming(ts, this.day, none).reduce((n, g) => n + g.tasks.length, 0);
      case 'week': return V.thisWeek(ts, this.day, none).reduce((n, g) => n + g.tasks.length, 0);
      case 'someday': return V.someday(ts, none).length;
      case 'tag': {
        const ids = new Set(this.taskTags.filter((tt) => tt.tag_id === v.id).map((tt) => tt.task_id));
        return ts.filter((t) => ids.has(t.id) && !t.completed_at).length;
      }
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
    const existing = db.one<Tag>('SELECT * FROM tags WHERE lower(name) = lower(?) ORDER BY id LIMIT 1', [name]);
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
  /**
   * Quick-add text that states where a new to-do goes from the current list, so it's visible and editable.
   * Leading space: it sits after the title, with the cursor in front of it.
   */
  contextToken(): string {
    const v = this.view;
    if (v.kind === 'today') return ' @today';
    if (v.kind === 'project') {
      const p = this.projects.find((x) => x.id === v.id);
      if (p) return ` +${p.name.trim().replace(/\s+/g, '-')}`;
    }
    return '';
  }
  private contextDefaults(): Partial<Task> {
    const v = this.view;
    switch (v.kind) {
      case 'today':
      case 'week':
        return { when_date: this.day };
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
      reminder_at: p.reminderAt,
      reminder_sent_at: null,
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

  update(id: ID, fields: Partial<Task>, label = 'change') {
    const t = this.task(id);
    if (t) {
      const prev = previousValues(t, fields);
      this.undoStack.push(label, () => db.update('tasks', id, prev as db.Row));
    }
    db.update('tasks', id, fields as db.Row);
    this.load();
  }

  /** Complete every to-do in `ids`, or uncheck them all if all are already done. One sound, one undo step. */
  completeMany(ids: ID[]) {
    if (ids.length <= 1) {
      if (ids[0]) this.toggleComplete(ids[0]);
      return;
    }
    const ts = ids.map((id) => this.task(id)).filter((t): t is Task => !!t);
    const uncheck = ts.every((t) => t.completed_at);
    this.bulk(uncheck ? 'uncheck' : 'complete', () => {
      for (const t of ts) if (uncheck || !t.completed_at) this.toggleComplete(t.id, true);
    });
    if (uncheck) sound.playUncheck();
    else sound.playComplete();
    this.notify(uncheck ? `Unchecked ${ts.length} to-dos` : `Completed ${ts.length} to-dos`);
  }

  toggleComplete(id: ID, quiet = false) {
    const t = this.task(id);
    if (!t) return;
    if (t.completed_at) {
      db.update('tasks', id, { completed_at: null });
      this.keep.delete(id);
      if (!quiet) sound.playUncheck();
      this.undoStack.push('uncheck', () => db.update('tasks', id, { completed_at: t.completed_at }));
    } else {
      db.update('tasks', id, { completed_at: new Date().toISOString() });
      // Undo also takes back the next occurrence of a repeating to-do (assigned below).
      let spawned: ID | null = null;
      this.undoStack.push('complete', () => {
        db.update('tasks', id, { completed_at: null });
        this.keep.delete(id);
        if (spawned) this.hardDelete(spawned);
      });
      this.keep.add(id);
      if (quiet) {
        // Bulk completion plays one sound for the lot.
      } else if (t.dump) sound.playScratch();
      else sound.playComplete();
      if (this.tracking?.taskId === id) this.stopTracking();
      const from = t.when_date && t.when_date > this.day ? t.when_date : this.day;
      // Counted from the to-do's own date, so a late check-off keeps the schedule; null once COUNT/UNTIL run out.
      const repeat = t.rrule ? nextRepeat(t.rrule, from, t.when_date ?? from) : null;
      if (t.rrule && !repeat) this.notify('That was the last repeat');
      if (repeat) {
        const next = repeat.date;
        const nid = db.uuid7();
        spawned = nid;
        db.insert('tasks', {
          ...(t as unknown as db.Row),
          id: nid,
          rrule: repeat.rrule,
          when_date: next,
          evening: t.evening,
          completed_at: null,
          created_at: new Date().toISOString(),
          // Same reminder time of day, moved to the next occurrence.
          reminder_at: t.reminder_at ? shiftReminder(t.reminder_at, t.when_date ?? this.day, next) : null,
          reminder_sent_at: null,
        });
        for (const tt of this.taskTags.filter((x) => x.task_id === id)) db.insert('task_tags', { id: db.uuid7(), task_id: nid, tag_id: tt.tag_id });
        for (const c of this.checklistFor(id)) db.insert('checklist', { id: db.uuid7(), task_id: nid, title: c.title, done: 0, sort: c.sort });
        this.notify(`Next: ${relLabel(next, this.day)}`);
      }
    }
    this.load();
  }

  /**
   * Set or clear a to-do's repeat (an RRULE string, see rrule.ts). With a `start` date the to-do moves to
   * the rule's first day on or after it, which is also where the series counts its weeks or months from.
   */
  setRepeat(id: ID, rrule: string | null, start?: string) {
    const t = this.task(id);
    if (!t) return;
    const fields: Partial<Task> = { rrule };
    if (rrule && start) {
      const first = firstOccurrence(rrule, start) ?? start;
      if (first !== t.when_date || t.someday) Object.assign(fields, { when_date: first, someday: 0 });
      if (t.reminder_at && t.when_date && first !== t.when_date) {
        fields.reminder_at = shiftReminder(t.reminder_at, t.when_date, first);
        fields.reminder_sent_at = null;
      }
    }
    this.update(id, fields, rrule ? 'repeat' : 'stop repeating');
    this.notify(rrule ? `Repeats: ${describeRule(rrule, this.day)}` : 'No longer repeats');
  }

  setWhen(id: ID, w: When) {
    this.update(id, {
      when_date: w.date,
      evening: w.evening ? 1 : 0,
      someday: w.someday ? 1 : 0,
      ...(w.inbox ? { project_id: null, area_id: null, heading_id: null } : {}),
    }, 'date change');
  }

  /** Toast naming the list a to-do landed in, for keyboard and palette actions that move it out of sight. */
  announceWhen(id: ID) {
    const t = this.task(id);
    if (t) this.notify(V.describeWhen(t, this.day));
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
    this.update(id, fields, 'move');
  }

  moveToDumpSection(id: ID, sectionId: ID | null) {
    this.update(id, { dump: 1, dump_section_id: sectionId }, 'move');
  }

  /** Fire reminders that are due: system notification (if allowed), chime, and an in-app toast. */
  fireDueReminders() {
    const due = dueReminders(this.tasks, Date.now());
    if (!due.length) return;
    const sentAt = new Date().toISOString();
    for (const t of due) db.update('tasks', t.id, { reminder_sent_at: sentAt });
    this.load();
    sound.playReminder();
    if (notifier.osDelivers) {
      // Native shells: the OS already showed these (scheduled ahead of time), so only chime and toast.
    } else if (due.length <= 3) {
      for (const t of due) void notifier.show(t.title, `Reminder · ${reminderLabel(t.reminder_at!, this.day)}`, t.id);
    } else {
      void notifier.show(`${due.length} reminders`, due.map((t) => t.title).join(', '));
    }
    this.notify(due.length === 1 ? `⏰ ${due[0].title}` : `⏰ ${due.length} reminders`);
  }

  /** A reveal requested before the first view was shown (notification tap that launched the app). */
  private pendingReveal: ID | null = null;
  private started = false;

  /** Show the first screen after init(): Today, or the task a notification / widget asked for. */
  start() {
    this.go({ kind: 'today' });
    this.started = true;
    const id = this.pendingReveal;
    this.pendingReveal = null;
    if (id) this.reveal(id);
  }

  /** Jump to the list that shows a task, then select and open it (used by notification clicks). */
  reveal(id: ID) {
    if (!this.started) {
      this.pendingReveal = id;
      return;
    }
    const t = this.task(id);
    if (!t) return;
    let v: ViewKey = { kind: 'inbox' };
    if (t.dump) v = { kind: 'dump' };
    else if (t.someday) v = { kind: 'someday' };
    else if (t.when_date && t.when_date <= this.day) v = { kind: 'today' };
    else if (t.when_date) v = { kind: 'upcoming' };
    else if (t.project_id) v = { kind: 'project', id: t.project_id };
    else if (t.area_id) v = { kind: 'area', id: t.area_id };
    this.go(v);
    this.selectedId = id;
    this.expandedId = id;
  }

  /** Set or clear a reminder. Setting one re-arms it. */
  setReminder(id: ID, iso: string | null) {
    this.update(id, { reminder_at: iso, reminder_sent_at: null }, 'reminder change');
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
    this.deleteMany([id]);
  }

  /** Move to-dos to the Trash as one undo step; the selection moves to the row after them. */
  deleteMany(ids: ID[]) {
    if (!ids.length) return;
    const idx = this.selectable.indexOf(ids[0]);
    const at = new Date().toISOString();
    this.bulk('move to Trash', () => {
      for (const id of ids) {
        if (this.tracking?.taskId === id) this.stopTracking();
        db.update('tasks', id, { deleted_at: at });
        this.undoStack.push('move to Trash', () => {
          db.update('tasks', id, { deleted_at: null });
          this.selectedId = id;
        });
        this.keep.delete(id);
      }
    });
    if (!this.isMulti) this.selectedId = this.selectable[Math.min(idx, this.selectable.length - 1)] ?? null;
    if (this.expandedId && ids.includes(this.expandedId)) this.expandedId = null;
    sound.playCrumple();
    this.notify(ids.length === 1 ? 'Moved to Trash' : `Moved ${ids.length} to-dos to Trash`);
  }

  /** Toast for a When change on several to-dos ("Moved 3 to-dos to Today"). */
  announceWhenMany(ids: ID[]) {
    if (ids.length === 1) return this.announceWhen(ids[0]);
    const t = this.task(ids[0]);
    if (t) this.notify(V.describeWhen(t, this.day).replace(/^Moved to/, `Moved ${ids.length} to-dos to`));
  }

  /**
   * Drag and drop inside the list: put `ids` (in list order) just before `beforeId` in group `groupKey`
   * (null = at its end). Rows from another group take on that group's fields (heading, evening, date,
   * matrix quadrant). Returns false if the group doesn't accept them. One undo step.
   */
  dropInList(ids: ID[], groupKey: string, beforeId: ID | null): boolean {
    const g = this.groups.find((x) => x.key === groupKey);
    const extra = this.dropFields(ids, groupKey);
    if (!g || !extra) return false;
    const sorts = Sel.moveBlock(g.items, ids, beforeId);
    // Dropped where they already were: nothing to write or undo.
    const now = g.items.map((t) => t.id).join();
    const next = g.items.map((t) => ({ id: t.id, sort: sorts.find((s) => s.id === t.id)?.sort ?? t.sort })).sort((a, b) => a.sort - b.sort).map((t) => t.id).join();
    if (now === next && [...extra.values()].every((f) => !Object.keys(f).length)) return true;
    this.bulk('move', () => {
      for (const { id, sort } of sorts) this.update(id, { ...extra.get(id), sort }, 'move');
    });
    return true;
  }

  /** Per-to-do fields for dropping `ids` into group `groupKey`, or null if that group refuses any of them. */
  dropFields(ids: ID[], groupKey: string): Map<ID, Partial<Task>> | null {
    if (!ids.length || !this.groups.some((x) => x.key === groupKey)) return null;
    const fromKey = (id: ID) => this.groups.find((x) => x.items.some((t) => t.id === id))?.key ?? '';
    const out = new Map<ID, Partial<Task>>();
    for (const id of ids) {
      const t = this.task(id);
      const f = t ? Sel.groupFields(this.view.kind, fromKey(id), groupKey, t, this.day) : null;
      if (!f) return null;
      out.set(id, f);
    }
    return out;
  }

  /** Whether dropping `ids` on a sidebar list does something. */
  acceptsDrop(v: ViewKey): boolean {
    if (this.isView(v) || !viewEnabled(v.kind)) return false;
    return ['inbox', 'today', 'anytime', 'someday', 'dump', 'logbook', 'trash', 'project', 'area'].includes(v.kind);
  }

  /**
   * Move to-dos to a top-level list, as one undo step: the Move palette and dropping on the sidebar.
   * Lists that need a day (Upcoming, This Week) go through When instead. Brain Dump only while
   * that feature is on.
   */
  moveToList(ids: ID[], list: MoveList) {
    if (!ids.length || (list === 'dump' && !viewEnabled('dump'))) return;
    const now = new Date().toISOString();
    this.each(ids, 'move', (id) => {
      const t = this.task(id);
      if (!t) return;
      const out = t.dump ? { dump: 0, dump_section_id: null } : {};
      switch (list) {
        case 'inbox':
          this.update(id, { ...out, when_date: null, evening: 0, someday: 0, project_id: null, area_id: null, heading_id: null }, 'move');
          break;
        case 'today':
          this.update(id, { ...out, when_date: this.day, evening: 0, someday: 0 }, 'move');
          break;
        case 'anytime':
          // Anytime keeps the project or area; a to-do in neither lands in the Inbox (said below).
          this.update(id, { ...out, when_date: null, evening: 0, someday: 0 }, 'move');
          break;
        case 'someday':
          this.update(id, { ...out, when_date: null, evening: 0, someday: 1 }, 'move');
          break;
        case 'dump':
          // Brain Dump deletes unchecked items 48h after created_at; restart the clock so an older
          // to-do isn't purged the moment it arrives.
          if (!t.dump) this.update(id, { dump: 1, dump_section_id: null, created_at: now }, 'move');
          break;
      }
    });
    const n = ids.length === 1 ? '' : ` ${ids.length} to-dos`;
    const name = { inbox: 'Inbox', today: 'Today', anytime: 'Anytime', someday: 'Someday', dump: 'Brain Dump' }[list];
    const loose = list === 'anytime' ? ids.filter((id) => { const t = this.task(id); return t && !t.project_id && !t.area_id; }).length : 0;
    if (loose === ids.length) this.notify(`Moved${n} to Inbox: Anytime needs a project or area`);
    else if (loose) this.notify(`Moved${n} to Anytime; ${loose} without a project or area went to the Inbox`);
    else this.notify(list === 'dump' ? `Moved${n} to Brain Dump; ${ids.length === 1 ? 'it goes' : 'they go'} in 48 hours unless kept` : `Moved${n} to ${name}`);
  }

  /** Drag and drop onto a sidebar list: schedule, move, complete or trash every dragged to-do. One undo step. */
  dropOnView(ids: ID[], v: ViewKey) {
    if (!ids.length || !this.acceptsDrop(v)) return;
    const n = ids.length === 1 ? '' : ` ${ids.length} to-dos`;
    switch (v.kind) {
      case 'inbox':
      case 'today':
      case 'anytime':
      case 'someday':
      case 'dump':
        this.moveToList(ids, v.kind);
        break;
      case 'logbook': {
        const open = ids.filter((id) => !this.task(id)?.completed_at);
        if (open.length) this.completeMany(open);
        break;
      }
      case 'trash':
        this.deleteMany(ids);
        break;
      case 'project':
      case 'area': {
        const target = v.kind === 'project' ? { project_id: v.id } : { area_id: v.id };
        this.each(ids, 'move', (id) => this.moveTo(id, target));
        const name = v.kind === 'project' ? this.projects.find((p) => p.id === v.id)?.name : this.areas.find((a) => a.id === v.id)?.name;
        this.notify(`Moved${n} to ${name ?? 'list'}`);
        break;
      }
    }
  }

  restoreTask(id: ID) {
    const idx = this.selectable.indexOf(id);
    const t = this.trashed.find((x) => x.id === id);
    // If its project or area was deleted meanwhile, restore to the Inbox.
    const orphan =
      (t?.project_id && !this.projects.some((p) => p.id === t.project_id)) || (t?.area_id && !this.areas.some((a) => a.id === t.area_id));
    db.update('tasks', id, orphan ? { deleted_at: null, project_id: null, area_id: null, heading_id: null } : { deleted_at: null });
    if (t) this.undoStack.push('restore', () => db.update('tasks', id, { deleted_at: t.deleted_at, project_id: t.project_id, area_id: t.area_id, heading_id: t.heading_id }));
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
    if (this.trashed.length) sound.playCrumple();
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

  /** ⌥↑ / ⌥↓ with several rows selected: move them together past one neighbour (same group only). */
  reorderMany(ids: ID[], dir: -1 | 1) {
    if (ids.length <= 1) {
      if (ids[0]) this.reorder(ids[0], dir);
      return;
    }
    const g = this.groups.find((x) => x.items.some((t) => t.id === ids[0]));
    if (!g || !ids.every((id) => g.items.some((t) => t.id === id))) return this.notify('Select rows from one group to move them');
    const before = Sel.stepTarget(g.items, ids, dir);
    if (before !== undefined) this.dropInList(ids, g.key, before);
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
  /**
   * Remove a dump section; its to-dos become unsectioned. Undo recreates it under a new id,
   * because a synced delete is final, and moves back the to-dos that are still unsectioned.
   */
  deleteDumpSection(id: ID) {
    const s = this.dumpSections.find((x) => x.id === id);
    if (!s) return;
    const taskIds = db.all<{ id: ID }>('SELECT id FROM tasks WHERE dump_section_id = ?', [id]).map((t) => t.id);
    for (const tid of taskIds) db.update('tasks', tid, { dump_section_id: null });
    db.remove('dump_sections', id);
    this.undoStack.push('remove section', () => {
      const nid = db.uuid7();
      db.insert('dump_sections', { id: nid, name: s.name, sort: s.sort });
      for (const tid of taskIds) {
        if (db.one('SELECT id FROM tasks WHERE id = ? AND dump = 1 AND dump_section_id IS NULL', [tid])) db.update('tasks', tid, { dump_section_id: nid });
      }
    });
    this.load();
    this.notify(`Removed “${s.name}”; its to-dos are unsectioned`);
  }
  renameArea(id: ID, name: string) {
    db.update('areas', id, { name });
    this.load();
  }

  renameProject(id: ID, name: string) {
    db.update('projects', id, { name });
    this.load();
  }

  moveProject(id: ID, areaId: ID | null) {
    db.update('projects', id, { area_id: areaId });
    this.load();
  }

  /** Delete an area. Its projects stay (without an area); its loose to-dos move to the Inbox. */
  deleteArea(id: ID) {
    for (const p of this.projects.filter((p) => p.area_id === id)) db.update('projects', p.id, { area_id: null });
    for (const t of db.all<Task>('SELECT * FROM tasks WHERE area_id = ?', [id])) db.update('tasks', t.id, { area_id: null });
    db.remove('areas', id);
    this.load();
    if (this.view.kind === 'area' && this.view.id === id) this.go({ kind: 'inbox' });
    this.notify('Area deleted');
  }

  /** Delete a project. Its open and completed to-dos go to the Trash (restorable for 30 days). */
  deleteProject(id: ID) {
    const now = new Date().toISOString();
    for (const t of db.all<Task>('SELECT * FROM tasks WHERE project_id = ? AND deleted_at IS NULL', [id])) {
      db.update('tasks', t.id, { deleted_at: now });
    }
    for (const h of this.headings.filter((h) => h.project_id === id)) db.remove('headings', h.id);
    db.remove('projects', id);
    this.load();
    if (this.view.kind === 'project' && this.view.id === id) this.go({ kind: 'inbox' });
    this.notify('Project deleted — its to-dos are in the Trash');
  }

  completeProject(id: ID) {
    const p = this.projects.find((x) => x.id === id);
    if (!p) return;
    db.update('projects', id, { completed_at: p.completed_at ? null : new Date().toISOString() });
    sound.playComplete();
    this.load();
  }

  // ---------- habits ----------

  /** Add a habit; trailing words set options (see parseHabit): "Gym 4x 60d". */
  addHabit(input: string) {
    const { name, target, schedule } = parseHabit(input);
    db.insert('habits', {
      id: db.uuid7(),
      name,
      sort: this.nextSort(),
      created_at: new Date().toISOString(),
      target_days: target,
      start_date: target ? this.day : null,
      schedule,
    });
    this.load();
  }

  setHabitSchedule(id: ID, schedule: V.HabitSchedule) {
    db.update('habits', id, { schedule: V.scheduleToString(schedule) });
    this.load();
    this.notify(V.describeSchedule(schedule));
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

  // ---------- focus mode ----------

  focusRemaining(): number {
    const f = this.focus;
    if (!f) return 0;
    return f.endsAt ? Math.max(0, f.endsAt - this.now) : f.remainingMs;
  }

  openFocus(taskId: ID) {
    if (this.focus?.taskId !== taskId) {
      if (this.focus?.endsAt && this.focus.phase === 'work') this.stopTracking();
      const ms = this.focusWorkMinutes * 60_000;
      this.focus = { taskId, phase: 'work', minutes: this.focusWorkMinutes, endsAt: null, remainingMs: ms, sessions: 0 };
    }
    this.expandedId = null;
    this.overlay = 'focus';
  }

  closeFocus() {
    this.overlay = null;
    // A timer that never started has nothing to keep.
    if (this.focus && !this.focus.endsAt && this.focus.remainingMs === this.focus.minutes * 60_000 && this.focus.sessions === 0) this.focus = null;
  }

  endFocus() {
    if (this.focus?.endsAt && this.focus.phase === 'work') this.stopTracking();
    this.focus = null;
    this.overlay = null;
  }

  focusToggle() {
    const f = this.focus;
    if (!f) return;
    if (f.endsAt) {
      f.remainingMs = Math.max(0, f.endsAt - Date.now());
      f.endsAt = null;
      if (f.phase === 'work') this.stopTracking();
    } else {
      f.endsAt = Date.now() + f.remainingMs;
      if (f.phase === 'work' && this.tracking?.taskId !== f.taskId) this.startTracking(f.taskId);
    }
  }

  focusReset() {
    const f = this.focus;
    if (!f) return;
    if (f.endsAt && f.phase === 'work') this.stopTracking();
    f.endsAt = null;
    f.remainingMs = f.minutes * 60_000;
  }

  focusSetMinutes(min: number) {
    const f = this.focus;
    if (!f) return;
    if (f.phase === 'work') this.focusWorkMinutes = min;
    const running = !!f.endsAt;
    f.minutes = min;
    f.remainingMs = min * 60_000;
    f.endsAt = running ? Date.now() + f.remainingMs : null;
  }

  /** Skip to the next phase (work → break, break → work) without waiting. */
  focusSkip() {
    if (this.focus) this.finishFocusPhase(true);
  }

  private finishFocusPhase(skipped = false) {
    const f = this.focus;
    if (!f) return;
    const task = this.task(f.taskId);
    if (f.phase === 'work') {
      this.stopTracking();
      if (!skipped) f.sessions++;
      // Every 4th session earns a long break.
      const brk = f.sessions > 0 && f.sessions % 4 === 0 ? 15 : 5;
      Object.assign(f, { phase: 'break', minutes: brk, endsAt: null, remainingMs: brk * 60_000 });
      if (!skipped) {
        sound.playBell();
        void notifier.show('Focus session done', `${task?.title ?? 'Task'} · take a ${brk}-minute break`, f.taskId);
        this.notify(`Session ${f.sessions} done — ${brk}-minute break`);
      }
    } else {
      Object.assign(f, { phase: 'work', minutes: this.focusWorkMinutes, endsAt: null, remainingMs: this.focusWorkMinutes * 60_000 });
      if (!skipped) {
        sound.playReminder();
        void notifier.show('Break over', `Back to: ${task?.title ?? 'your task'}`, f.taskId);
        this.notify('Break over');
      }
    }
  }

  // ---------- misc ----------

  toggleMute() {
    this.muted = !this.muted;
    sound.setMuted(this.muted);
    if (!this.muted) sound.playComplete();
    this.notify(this.muted ? 'Sounds off' : 'Sounds on');
  }

  exportJson() {
    const blob = new Blob([db.exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `openthings-${this.day}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /**
   * Write a planned Things import in one transaction, then refresh the app.
   * Importing adds to existing data; it never replaces or deletes anything.
   */
  importThings(plan: ThingsImport): void {
    const rows: db.BulkInsert[] = [];
    const add = (tbl: string, items: readonly { id: string }[]) => {
      for (const row of items) rows.push({ tbl, row: row as unknown as db.Row & { id: string } });
    };
    // Tags are unique by name; reuse any that already exist so importing twice
    // (or into existing data) doesn't hit the unique constraint.
    const tags = mergeImportedTags(db.all<Tag>('SELECT * FROM tags'), plan.tags, plan.taskTags);
    add('areas', plan.areas);
    add('projects', plan.projects);
    add('headings', plan.headings);
    add('tags', tags.tags);
    add('tasks', plan.tasks);
    add('task_tags', tags.taskTags);
    add('checklist', plan.checklist);
    db.bulkInsert(rows);
    this.load();
    this.notify(`Imported ${plan.stats.todos} to-do${plan.stats.todos === 1 ? '' : 's'} from Things`);
  }
}

export const store = new Store();
