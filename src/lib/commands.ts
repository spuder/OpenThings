/**
 * Command registry. Every action is a command with an id, a title and default keys.
 * Keyboard handling, the command palette and the help sheet all read from this list,
 * so a shortcut exists for everything the UI can do.
 */
import { store } from './store.svelte';
import { theme } from './theme.svelte';
import { isNarrow, isTouch } from './env';
import type { ViewKey } from './types';
import { features, viewEnabled } from './features.svelte';

export interface Command {
  id: string;
  title: string;
  group: 'Navigate' | 'Create' | 'Selection' | 'Task' | 'Brain dump' | 'Habits' | 'Calendar' | 'Trash' | 'Time' | 'App';
  /** Key strings: "x", "alt+1", "mod+k", "shift+p", sequences "g t". */
  keys: string[];
  /** Command only applies when this returns true (default: always). */
  when?: () => boolean;
  run: () => void;
  /** Hidden from the palette (still bound to keys). */
  hidden?: boolean;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const sel = () => store.task(store.selectedId);
const inHabits = () => store.view.kind === 'habits';
const inTrash = () => store.view.kind === 'trash';
const inCalendar = () => store.view.kind === 'timeblock';
/** A time block is selected (and its inline box isn't taking the keys). */
const hasBlock = () => inCalendar() && !!store.block(store.blockSelectedId) && !store.blockEditingId;
const withBlock = (fn: (id: string) => void) => () => {
  if (store.blockSelectedId) fn(store.blockSelectedId);
};
/** One to-do selected: commands that only make sense for a single item (open, tag, timer…). */
const hasTask = () => !!sel() && !inHabits() && !store.isMulti;
/** The to-dos bulk-capable commands act on: the multi-selection, or the selected row. */
const targets = () => (inHabits() ? [] : store.actionIds.filter((id) => !!store.task(id)));
const hasTargets = () => targets().length > 0;

function typingNow() {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

function withTask(fn: (id: string) => void) {
  return () => {
    const t = sel();
    if (t) fn(t.id);
  };
}

/** Run `fn` for every target as one undo step, then `after` once with all of them. */
function withTargets(label: string, fn: (id: string) => void, after?: (ids: string[]) => void) {
  return () => {
    const ids = targets();
    if (!ids.length) return;
    store.each(ids, label, fn);
    after?.(ids);
  };
}

function openPalette(kind: 'commands' | 'move' | 'when' | 'deadline' | 'tag' | 'challenge' | 'reminder' | 'schedule') {
  store.paletteMode = { kind };
  store.overlay = 'palette';
}

export function prompt(label: string, onSubmit: (v: string) => void, placeholder?: string, initial?: string) {
  store.paletteMode = { kind: 'prompt', label, placeholder, initial, onSubmit };
  store.overlay = 'palette';
}

/**
 * Ask before a destructive action, in the palette. `window.confirm()` returns false at once in
 * the macOS app (WKWebView shows no dialog), so it can't be used. Cancel comes first, so a
 * second Enter doesn't delete anything.
 */
export function confirmAction(label: string, action: string, run: () => void, hint?: string) {
  store.paletteMode = {
    kind: 'choose',
    label,
    options: [
      { label: 'Cancel', run: () => {} },
      { label: action, hint, run },
    ],
  };
  store.overlay = 'palette';
}

export function confirmEmptyTrash() {
  const n = store.trashed.length;
  confirmAction(`Permanently delete ${n} to-do${n === 1 ? '' : 's'}?`, 'Empty Trash', () => store.emptyTrash(), 'can’t be undone');
}

function moveSelection(delta: number) {
  const list = store.selectable;
  if (!list.length) return;
  const i = store.selectedId ? list.indexOf(store.selectedId) : -1;
  const next = i < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, i + delta));
  setCursor(list[next]);
}

/** Move the keyboard cursor. In selection mode the selected set stays; otherwise a multi-selection collapses to this row. */
function setCursor(id: string | null) {
  if (store.selecting) store.multi = { ...store.multi, cursor: id };
  else if (store.isMulti) store.clearMulti();
  store.selectedId = id;
  if (store.expandedId && store.expandedId !== id) store.expandedId = null;
}

/** The area the current view is, or the area its project is in. */
function currentArea(): string | null {
  const v = store.view;
  if (v.kind === 'area') return v.id;
  if (v.kind === 'project') return store.projects.find((p) => p.id === v.id)?.area_id ?? null;
  return null;
}
const anyAreaOpen = () => store.foldableAreas.some((a) => !store.collapsedAreas.has(a.id));
const anyAreaFolded = () => store.foldableAreas.some((a) => store.collapsedAreas.has(a.id));

/** Rename / move / delete menu for an area or project, shown in the palette. Each option has a letter (see menu.ts). */
export function openListMenu(target: { kind: 'area' | 'project'; id: string }) {
  if (target.kind === 'area') {
    const a = store.areas.find((x) => x.id === target.id);
    if (!a) return;
    store.paletteMode = {
      kind: 'choose',
      label: a.name,
      options: [
        { label: 'Rename…', key: 'r', icon: 'rename', run: () => prompt('Rename area', (n) => store.renameArea(a.id, n), a.name, a.name) },
        { label: 'New project in this area…', key: 'n', icon: 'add', run: () => prompt('New project', (n) => store.go({ kind: 'project', id: store.addProject(n, a.id) })) },
        anyAreaOpen()
          ? { label: 'Collapse all areas', key: 'c', icon: 'chevron', run: () => store.setAreasCollapsed(true) }
          : { label: 'Expand all areas', key: 'e', icon: 'chevron', run: () => store.setAreasCollapsed(false) },
        {
          label: 'Delete area',
          key: 'd',
          icon: 'delete',
          danger: true,
          hint: 'projects are kept, its to-dos go to the Inbox',
          run: () => confirmAction(`Delete the area “${a.name}”?`, 'Delete area', () => store.deleteArea(a.id), 'projects are kept, its to-dos go to the Inbox'),
        },
      ],
    };
  } else {
    const p = store.projects.find((x) => x.id === target.id);
    if (!p) return;
    store.paletteMode = {
      kind: 'choose',
      label: p.name,
      options: [
        { label: 'Rename…', key: 'r', icon: 'rename', run: () => prompt('Rename project', (n) => store.renameProject(p.id, n), p.name, p.name) },
        {
          label: 'Move to area…',
          key: 'm',
          icon: 'move',
          run: () => {
            store.paletteMode = {
              kind: 'choose',
              label: `Move “${p.name}” to`,
              options: [
                { label: 'No area', run: () => store.moveProject(p.id, null) },
                ...store.areas.map((a) => ({ label: a.name, hint: a.id === p.area_id ? 'current' : undefined, run: () => store.moveProject(p.id, a.id) })),
              ],
            };
            store.overlay = 'palette';
          },
        },
        { label: 'New heading…', key: 'h', icon: 'heading', run: () => prompt('New heading', (n) => store.addHeading(p.id, n)) },
        ...(store.headings.some((h) => h.project_id === p.id)
          ? [
              {
                label: 'Remove heading…',
                key: 'e',
                icon: 'unheading',
                hint: 'its to-dos stay in the project',
                run: () => {
                  store.paletteMode = {
                    kind: 'choose',
                    label: 'Remove heading',
                    options: store.headings.filter((h) => h.project_id === p.id).map((h) => ({ label: h.name, run: () => store.deleteHeading(h.id) })),
                  };
                  store.overlay = 'palette';
                },
              },
            ]
          : []),
        { label: 'Complete project', key: 'c', icon: 'complete', run: () => store.completeProject(p.id) },
        {
          label: 'Delete project',
          key: 'd',
          icon: 'delete',
          danger: true,
          hint: 'its to-dos go to the Trash',
          run: () => confirmAction(`Delete the project “${p.name}”?`, 'Delete project', () => store.deleteProject(p.id), 'its to-dos go to the Trash for 30 days'),
        },
      ],
    };
  }
  store.overlay = 'palette';
}

/** Right-click menu for a to-do: its Task commands, shown in the palette like the list menu. */
export function openTaskMenu(id: string) {
  const t = store.task(id);
  if (!t) return;
  store.selectedId = id;
  store.paletteMode = {
    kind: 'choose',
    label: t.title,
    options: commands
      .filter((c) => c.group === 'Task' && !c.hidden && applicable(c))
      .map((c) => ({ label: c.title, hint: c.keys[0] ? keyLabel(c.keys[0]) : undefined, run: c.run })),
  };
  store.overlay = 'palette';
}

const nav = (title: string, v: ViewKey, n: number | null, letter: string): Command => ({
  id: `go.${v.kind}`,
  title: `Go to ${title}`,
  group: 'Navigate',
  keys: n === null ? [`g ${letter}`] : [`alt+${n}`, `g ${letter}`],
  when: () => viewEnabled(v.kind),
  run: () => store.go(v),
});

export const commands: Command[] = [
  nav('Inbox', { kind: 'inbox' }, 1, 'i'),
  nav('Today', { kind: 'today' }, 2, 't'),
  nav('This Week', { kind: 'week' }, null, 'w'),
  nav('Upcoming', { kind: 'upcoming' }, 3, 'u'),
  nav('Anytime', { kind: 'anytime' }, 4, 'a'),
  nav('Someday', { kind: 'someday' }, 5, 's'),
  nav('Logbook', { kind: 'logbook' }, 6, 'l'),
  nav('Brain Dump', { kind: 'dump' }, 7, 'd'),
  nav('Habits', { kind: 'habits' }, 8, 'h'),
  nav('Matrix', { kind: 'matrix' }, 9, 'm'),
  nav('Time Blocking', { kind: 'timeblock' }, null, 'c'),
  nav('Trash', { kind: 'trash' }, 0, 'x'),
  { id: 'go.settings', title: 'Settings', group: 'Navigate', keys: ['mod+,', 'g ,'], run: () => store.go({ kind: 'settings' }) },

  {
    id: 'create.quickadd',
    title: 'Quick add',
    group: 'Create',
    keys: ['n', 'mod+n', 'ctrl+space'],
    run: () => {
      store.quickAddPrefill = store.contextToken();
      store.overlay = 'quickadd';
    },
  },
  {
    id: 'create.dump',
    title: 'Add to brain dump',
    group: 'Create',
    keys: ['b'],
    when: () => features.enabled('dump'),
    run: () => {
      store.quickAddPrefill = '@dump ';
      store.overlay = 'quickadd';
    },
  },
  {
    id: 'create.project',
    title: 'New project',
    group: 'Create',
    keys: ['mod+shift+n'],
    when: () => !inHabits(),
    run: () =>
      prompt('New project', (name) => {
        const areaId = store.view.kind === 'area' ? store.view.id : null;
        store.go({ kind: 'project', id: store.addProject(name, areaId) });
      }),
  },
  {
    id: 'create.area',
    title: 'New area of responsibility',
    group: 'Create',
    keys: ['shift+a'],
    run: () => prompt('New area', (name) => store.go({ kind: 'area', id: store.addArea(name) })),
  },
  {
    id: 'create.heading',
    title: 'New heading in project',
    group: 'Create',
    keys: ['shift+h'],
    when: () => store.view.kind === 'project',
    run: () => {
      const v = store.view;
      if (v.kind === 'project') prompt('New heading', (name) => store.addHeading(v.id, name));
    },
  },
  {
    id: 'create.section',
    title: 'New brain dump section',
    group: 'Brain dump',
    // Shift+H, like a new heading in a project.
    keys: ['shift+h', 'shift+s'],
    when: () => store.view.kind === 'dump',
    run: () => prompt('New section', (name) => store.addDumpSection(name)),
  },
  {
    id: 'dump.removeSection',
    title: 'Remove brain dump section…',
    group: 'Brain dump',
    keys: ['shift+backspace'],
    when: () => store.view.kind === 'dump' && store.dumpSections.length > 0,
    run: () => {
      const current = sel()?.dump_section_id;
      store.paletteMode = {
        kind: 'choose',
        label: 'Remove section (its to-dos are kept)',
        options: store.dumpSections.map((s) => ({ label: s.name, hint: s.id === current ? 'current' : undefined, run: () => store.deleteDumpSection(s.id) })),
      };
      store.overlay = 'palette';
    },
  },
  {
    id: 'create.habit',
    title: 'New habit',
    group: 'Habits',
    keys: ['shift+h'],
    when: inHabits,
    run: () => prompt('New habit', (name) => store.addHabit(name)),
  },

  // Time Blocking calendar. Listed before the to-do selection keys so J / K / Enter act on blocks there.
  { id: 'cal.new', title: 'New time block', group: 'Calendar', keys: ['shift+b'], when: inCalendar, run: () => store.addBlockNow() },
  { id: 'cal.prev', title: 'Previous days', group: 'Calendar', keys: ['[', 'arrowleft'], when: inCalendar, run: () => store.stepCalendar(-1) },
  { id: 'cal.next', title: 'Next days', group: 'Calendar', keys: [']', 'arrowright'], when: inCalendar, run: () => store.stepCalendar(1) },
  { id: 'cal.today', title: 'Go to today', group: 'Calendar', keys: ['t'], when: inCalendar, run: () => store.calendarToday() },
  { id: 'cal.day', title: 'Show one day', group: 'Calendar', keys: ['1'], when: inCalendar, run: () => store.setCalRange('day') },
  { id: 'cal.3day', title: 'Show 3 days', group: 'Calendar', keys: ['3'], when: inCalendar, run: () => store.setCalRange('3day') },
  { id: 'cal.week', title: 'Show 7 days', group: 'Calendar', keys: ['7'], when: inCalendar, run: () => store.setCalRange('week') },
  { id: 'cal.4week', title: 'Show 4 weeks', group: 'Calendar', keys: ['4'], when: inCalendar, run: () => store.setCalRange('4week') },
  { id: 'cal.down', title: 'Select next block', group: 'Calendar', keys: ['j', 'arrowdown'], when: inCalendar, run: () => store.selectBlock(1), hidden: true },
  { id: 'cal.up', title: 'Select previous block', group: 'Calendar', keys: ['k', 'arrowup'], when: inCalendar, run: () => store.selectBlock(-1), hidden: true },
  { id: 'cal.edit', title: 'Assign block (area, project, to-do)', group: 'Calendar', keys: ['enter', 'o'], when: hasBlock, run: withBlock((id) => (store.blockEditingId = id)) },
  { id: 'cal.earlier', title: 'Move block earlier', group: 'Calendar', keys: ['alt+arrowup', 'shift+k'], when: hasBlock, run: withBlock((id) => store.nudgeBlock(id, -15)) },
  { id: 'cal.later', title: 'Move block later', group: 'Calendar', keys: ['alt+arrowdown', 'shift+j'], when: hasBlock, run: withBlock((id) => store.nudgeBlock(id, 15)) },
  { id: 'cal.shorter', title: 'Shorten block', group: 'Calendar', keys: ['alt+shift+arrowup'], when: hasBlock, run: withBlock((id) => store.nudgeBlock(id, -15, true)) },
  { id: 'cal.longer', title: 'Lengthen block', group: 'Calendar', keys: ['alt+shift+arrowdown'], when: hasBlock, run: withBlock((id) => store.nudgeBlock(id, 15, true)) },
  { id: 'cal.dayBefore', title: 'Move block to the day before', group: 'Calendar', keys: ['alt+arrowleft', 'shift+h'], when: hasBlock, run: withBlock((id) => store.moveBlockDay(id, -1)) },
  { id: 'cal.dayAfter', title: 'Move block to the day after', group: 'Calendar', keys: ['alt+arrowright', 'shift+l'], when: hasBlock, run: withBlock((id) => store.moveBlockDay(id, 1)) },
  { id: 'cal.delete', title: 'Delete block', group: 'Calendar', keys: ['backspace', 'delete'], when: hasBlock, run: withBlock((id) => store.deleteBlock(id)) },
  { id: 'cal.panel', title: 'Show / hide to-dos beside the calendar', group: 'Calendar', keys: ['l'], when: inCalendar, run: () => store.toggleCalPanel() },
  {
    id: 'cal.blockFor',
    title: 'Block time on the calendar',
    group: 'Calendar',
    keys: ['shift+c'],
    // The selected to-do; otherwise the area or project you're in.
    when: () => viewEnabled('timeblock') && (hasTask() || store.view.kind === 'area' || store.view.kind === 'project'),
    run: () => {
      const v = store.view;
      if (hasTask() && store.selectedId) store.blockTimeFor({ kind: 'task', id: store.selectedId });
      else if (v.kind === 'area' || v.kind === 'project') store.blockTimeFor({ kind: v.kind, id: v.id });
    },
  },
  { id: 'cal.escape', title: 'Deselect block', group: 'Calendar', keys: ['escape'], when: () => inCalendar() && !!store.blockSelectedId, run: () => (store.blockSelectedId = null), hidden: true },

  { id: 'sel.down', title: 'Select next', group: 'Selection', keys: ['j', 'arrowdown'], run: () => moveSelection(1), hidden: true },
  { id: 'sel.up', title: 'Select previous', group: 'Selection', keys: ['k', 'arrowup'], run: () => moveSelection(-1), hidden: true },
  { id: 'sel.first', title: 'Select first', group: 'Selection', keys: ['g g', 'home'], run: () => setCursor(store.selectable[0] ?? null), hidden: true },
  { id: 'sel.last', title: 'Select last', group: 'Selection', keys: ['shift+g', 'end'], run: () => setCursor(store.selectable.at(-1) ?? null), hidden: true },
  // Multi-select. Shift+J/K already move a to-do, so extending uses Shift+arrows (and Shift / ⌘ click).
  { id: 'sel.extendDown', title: 'Extend selection down', group: 'Selection', keys: ['shift+arrowdown'], when: () => store.canMulti, run: () => store.extendSelection(1), hidden: true },
  { id: 'sel.extendUp', title: 'Extend selection up', group: 'Selection', keys: ['shift+arrowup'], when: () => store.canMulti, run: () => store.extendSelection(-1), hidden: true },
  { id: 'sel.all', title: 'Select all to-dos in this list', group: 'Selection', keys: ['mod+a'], when: () => store.canMulti && !typingNow() && store.selectable.length > 0, run: () => store.selectAll() },
  {
    id: 'sel.mode',
    title: 'Select multiple (tap or click to pick)',
    group: 'Selection',
    keys: ['v'],
    when: () => store.canMulti,
    run: () => (store.selecting ? store.clearMulti() : store.startSelecting()),
  },
  {
    id: 'sel.toggle',
    title: 'Pick / unpick this to-do',
    group: 'Selection',
    keys: ['space'],
    when: () => store.selecting && !!store.selectedId,
    run: () => store.selectedId && store.toggleSelect(store.selectedId),
    hidden: true,
  },
  {
    id: 'task.open',
    title: 'Open / close task',
    group: 'Selection',
    keys: ['enter', 'o'],
    when: hasTask,
    run: withTask((id) => (store.expandedId = store.expandedId === id ? null : id)),
  },
  {
    id: 'sel.escape',
    title: 'Close / deselect',
    group: 'Selection',
    keys: ['escape'],
    hidden: true,
    run: () => {
      if (store.isMulti) store.clearMulti();
      else if (store.expandedId) store.expandedId = null;
      else store.selectedId = null;
    },
  },

  // These act on every selected to-do (one undo step); the rest below are single to-do only.
  { id: 'task.complete', title: 'Complete task', group: 'Task', keys: ['c', 'mod+enter'], when: hasTargets, run: () => store.completeMany(targets()) },
  { id: 'task.today', title: 'Start today', group: 'Task', keys: ['t'], when: hasTargets, run: withTargets('date change', (id) => store.setToday(id), (ids) => store.announceWhenMany(ids)) },
  { id: 'task.evening', title: 'This evening', group: 'Task', keys: ['e'], when: hasTargets, run: withTargets('date change', (id) => store.setEvening(id), (ids) => store.announceWhenMany(ids)) },
  { id: 'task.tomorrow', title: 'Tomorrow', group: 'Task', keys: ['r'], when: hasTargets, run: withTargets('date change', (id) => store.setTomorrow(id), (ids) => store.announceWhenMany(ids)) },
  { id: 'task.someday', title: 'Someday', group: 'Task', keys: ['s'], when: hasTargets, run: withTargets('date change', (id) => store.setSomeday(id), (ids) => store.announceWhenMany(ids)) },
  { id: 'task.when', title: 'When…', group: 'Task', keys: ['w'], when: hasTargets, run: () => openPalette('when') },
  { id: 'task.deadline', title: 'Deadline…', group: 'Task', keys: ['d'], when: hasTargets, run: () => openPalette('deadline') },
  { id: 'task.reminder', title: 'Reminder…', group: 'Task', keys: ['a'], when: hasTask, run: () => openPalette('reminder') },
  { id: 'task.repeat', title: 'Repeat…', group: 'Task', keys: ['shift+w'], when: hasTask, run: () => (store.overlay = 'repeat') },
  { id: 'task.move', title: 'Move to…', group: 'Task', keys: ['m'], when: hasTargets, run: () => openPalette('move') },
  { id: 'task.tag', title: 'Add tag…', group: 'Task', keys: ['#', 'l'], when: hasTask, run: () => openPalette('tag') },
  { id: 'task.urgent', title: 'Toggle urgent', group: 'Task', keys: ['u'], when: hasTask, run: withTask((id) => { store.toggleUrgent(id); store.notify(sel()?.urgent ? 'Marked urgent' : 'Not urgent'); }) },
  { id: 'task.important', title: 'Toggle important', group: 'Task', keys: ['i'], when: hasTask, run: withTask((id) => { store.toggleImportant(id); store.notify(sel()?.important ? 'Marked important' : 'Not important'); }) },
  { id: 'task.up', title: 'Move up', group: 'Task', keys: ['alt+arrowup', 'shift+k'], when: hasTargets, run: () => store.reorderMany(targets(), -1) },
  { id: 'task.down', title: 'Move down', group: 'Task', keys: ['alt+arrowdown', 'shift+j'], when: hasTargets, run: () => store.reorderMany(targets(), 1) },
  { id: 'task.delete', title: 'Move to Trash', group: 'Task', keys: ['backspace', 'delete'], when: hasTargets, run: () => store.deleteMany(targets()) },

  { id: 'dump.keep', title: 'Keep: move to Inbox', group: 'Brain dump', keys: ['shift+i'], when: () => !!sel()?.dump, run: withTask((id) => { store.moveTo(id, { inbox: true }); store.notify('Moved to Inbox'); }) },

  { id: 'habit.toggle', title: 'Check habit for today', group: 'Habits', keys: ['x', 'space'], when: () => inHabits() && !!store.selectedId, run: () => store.selectedId && store.toggleHabit(store.selectedId) },
  {
    id: 'habit.challenge',
    title: 'Set challenge length (30/60/75 days)…',
    group: 'Habits',
    keys: ['c'],
    when: () => inHabits() && !!store.selectedId,
    run: () => openPalette('challenge'),
  },
  {
    id: 'habit.schedule',
    title: 'Habit schedule (every day, weekdays, N× a week)…',
    group: 'Habits',
    keys: ['w'],
    when: () => inHabits() && !!store.selectedId,
    run: () => openPalette('schedule'),
  },
  { id: 'habit.delete', title: 'Delete habit', group: 'Habits', keys: ['backspace', 'delete'], when: () => inHabits() && !!store.selectedId, run: () => store.selectedId && store.deleteHabit(store.selectedId) },

  { id: 'trash.restore', title: 'Restore from Trash', group: 'Trash', keys: ['shift+r', 'enter'], when: () => inTrash() && !!store.selectedId, run: () => store.selectedId && store.restoreTask(store.selectedId) },
  { id: 'trash.purge', title: 'Delete permanently', group: 'Trash', keys: ['backspace', 'delete'], when: () => inTrash() && !!store.selectedId, run: () => store.selectedId && store.purgeTask(store.selectedId) },
  { id: 'trash.empty', title: 'Empty Trash', group: 'Trash', keys: [], when: () => store.trashed.length > 0, run: confirmEmptyTrash },

  { id: 'time.track', title: 'Start / stop timer', group: 'Time', keys: ['p'], when: hasTask, run: withTask((id) => store.toggleTracking(id)) },
  {
    id: 'time.focus',
    title: 'Focus on this to-do (Pomodoro)',
    group: 'Time',
    keys: ['f'],
    when: () => hasTask() || !!store.focus,
    run: () => {
      const t = sel();
      if (t) store.openFocus(t.id);
      else if (store.focus) store.overlay = 'focus';
    },
  },
  { id: 'time.pomodoro', title: 'Start Pomodoro (25 min)', group: 'Time', keys: ['shift+p'], run: () => (store.pomodoro ? store.cancelPomodoro() : store.startPomodoro(sel()?.id ?? null)) },
  { id: 'time.stop', title: 'Stop timer', group: 'Time', keys: ['shift+x'], when: () => !!store.tracking, run: () => store.stopTracking() },

  {
    id: 'list.menu',
    title: 'List actions (rename, delete…)',
    group: 'App',
    keys: ['shift+l'],
    when: () => store.view.kind === 'area' || store.view.kind === 'project',
    run: () => {
      const v = store.view;
      if (v.kind === 'area') openListMenu({ kind: 'area', id: v.id });
      if (v.kind === 'project') openListMenu({ kind: 'project', id: v.id });
    },
  },
  // Outside a text field; inside one, ⌘Z / Ctrl+Z is the field's own text undo.
  { id: 'app.undo', title: 'Undo', group: 'App', keys: ['mod+z'], when: () => !typingNow(), run: () => store.undo() },
  { id: 'app.find', title: 'Quick Find', group: 'App', keys: ['mod+f', '/'], run: () => (store.overlay = 'find') },
  { id: 'app.sidebar', title: 'Show / hide sidebar', group: 'App', keys: ['mod+/'], run: () => store.toggleSidebar() },
  // Folds, like an outline: z a this one, z m all closed, z r all open.
  {
    id: 'area.fold',
    title: 'Collapse / expand this area in the sidebar',
    group: 'App',
    keys: ['z a'],
    when: () => !!currentArea(),
    run: () => {
      const id = currentArea();
      if (id) store.toggleArea(id);
    },
  },
  { id: 'area.collapseAll', title: 'Collapse all areas', group: 'App', keys: ['z m'], when: anyAreaOpen, run: () => store.setAreasCollapsed(true) },
  { id: 'area.expandAll', title: 'Expand all areas', group: 'App', keys: ['z r'], when: anyAreaFolded, run: () => store.setAreasCollapsed(false) },
  { id: 'app.palette', title: 'Command palette', group: 'App', keys: ['mod+k', 'mod+shift+p', ':'], run: () => openPalette('commands'), hidden: true },
  { id: 'app.help', title: 'Keyboard shortcuts', group: 'App', keys: ['?'], run: () => (store.overlay = store.overlay === 'help' ? null : 'help') },
  {
    id: 'app.themes',
    title: 'Choose theme (Omarchy themes)…',
    group: 'App',
    keys: ['shift+t'],
    // Desktop only: the picker is built for a keyboard and a wide screen. On an Omarchy desktop the
    // theme follows the system's.
    when: () => !isTouch && !isNarrow() && !theme.following,
    run: () => (store.overlay = 'themes'),
  },
  { id: 'app.theme', title: 'Toggle dark mode', group: 'App', keys: ['shift+d'], when: () => !theme.following, run: () => { theme.toggle(); store.notify(theme.isDark ? 'Dark mode' : 'Light mode'); } },
  { id: 'app.mute', title: 'Toggle sounds', group: 'App', keys: ['shift+m'], run: () => store.toggleMute() },
  { id: 'app.export', title: 'Export JSON backup', group: 'App', keys: ['mod+shift+e'], run: () => store.exportJson() },
];

// ---------- key matching ----------

/**
 * Whether Ctrl (⌘ on macOS) is held, from its own key events. On Wayland, fcitx5 drops a held
 * modifier from key events once a text field loses focus, so holding Ctrl and pressing K again
 * would arrive as a plain K. The Ctrl key-up still arrives, so trust the key over the flag.
 */
let modHeld = false;

/** Feed window keydown / keyup / blur here to keep `modHeld` current. */
export function trackModifier(e: KeyboardEvent | FocusEvent) {
  if (e.type === 'blur') modHeld = false;
  else if ((e as KeyboardEvent).key === (isMac ? 'Meta' : 'Control')) modHeld = e.type === 'keydown';
}

/** Normalise a keyboard event to a key string like "mod+k", "alt+1", "shift+p", "?". */
export function eventKey(e: KeyboardEvent): string {
  let key = e.key.toLowerCase();
  if (key === ' ') key = 'space';
  // On macOS, Option+digit produces symbols; use the physical key.
  if (e.altKey && /^Digit\d$/.test(e.code)) key = e.code.slice(5);
  if (e.altKey && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase();
  const parts: string[] = [];
  const mod = (isMac ? e.metaKey : e.ctrlKey) || modHeld;
  if (mod) parts.push('mod');
  if (isMac && e.ctrlKey) parts.push('ctrl');
  if (!isMac && e.metaKey) parts.push('meta');
  if (e.altKey) parts.push('alt');
  // Shift is implied for punctuation like ? # :
  const printable = key.length === 1 && !/[a-z0-9]/.test(key);
  if (e.shiftKey && !printable) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

/** Pretty label for a key string, platform aware. */
export function keyLabel(k: string): string {
  return k
    .split(' ')
    .map((chord) =>
      chord
        .split('+')
        .map((p) => {
          switch (p) {
            case 'mod': return isMac ? '⌘' : 'Ctrl';
            case 'ctrl': return isMac ? '⌃' : 'Ctrl';
            case 'alt': return isMac ? '⌥' : 'Alt';
            case 'shift': return '⇧';
            case 'enter': return '↵';
            case 'escape': return 'Esc';
            case 'arrowup': return '↑';
            case 'arrowdown': return '↓';
            case 'backspace': return '⌫';
            case 'delete': return 'Del';
            case 'space': return 'Space';
            default: return p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1);
          }
        })
        .join(isMac ? '' : '+'),
    )
    .join(' then ');
}

let pending: string | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | undefined;

function applicable(c: Command) {
  return !c.when || c.when();
}

/** Global keydown handler. Returns true if a command ran. */
export function handleKey(e: KeyboardEvent): boolean {
  if (e.isComposing) return false;
  const target = e.target as HTMLElement | null;
  const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  const k = eventKey(e);
  if (['shift', 'alt', 'control', 'meta', 'mod+meta', 'ctrl+control'].some((m) => k.endsWith(m))) return false;

  // While typing, only modifier chords pass through (Esc is handled by the field).
  if (typing && !k.includes('mod+') && !k.startsWith('alt+')) return false;
  if (store.overlay) return false;

  const candidates = commands.filter(applicable);
  const full = pending ? `${pending} ${k}` : k;
  let cmd = candidates.find((c) => c.keys.includes(full));
  if (!cmd && pending) cmd = candidates.find((c) => c.keys.includes(k));
  pending = null;
  clearTimeout(pendingTimer);

  if (cmd) {
    e.preventDefault();
    cmd.run();
    return true;
  }
  // Start of a sequence like "g t"?
  if (candidates.some((c) => c.keys.some((key) => key.startsWith(`${k} `)))) {
    e.preventDefault();
    pending = k;
    pendingTimer = setTimeout(() => (pending = null), 1200);
    return true;
  }
  return false;
}
