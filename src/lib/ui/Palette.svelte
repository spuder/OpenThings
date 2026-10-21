<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { store } from '../store.svelte';
  import { commands, keyLabel } from '../commands';
  import { viewEnabled } from '../features.svelte';
  import { parseDateWord, parseReminder, reminderLabel } from '../parse';
  import { notifier } from '../reminders.svelte';
  import { parseSchedule, scheduleToString, type HabitSchedule } from '../views';
  import { addDays, longLabel, nextWeekday, relLabel } from '../dates';

  interface Item {
    label: string;
    hint?: string;
    keys?: string;
    run: () => void;
  }

  let q = $state('');
  // A menu item can open another palette step (e.g. "Rename…"); start each step fresh.
  $effect(() => {
    const m = store.paletteMode;
    q = m.kind === 'prompt' ? (m.initial ?? '') : '';
    input?.focus();
    if (m.kind === 'prompt' && m.initial) queueMicrotask(() => input?.select());
  });
  let index = $state(0);
  let input: HTMLInputElement | undefined = $state();

  const mode = $derived(store.paletteMode);
  const task = $derived(store.task(store.selectedId));
  /** Move, When and Deadline apply to every selected to-do. */
  const ids = $derived(store.actionIds.filter((id) => !!store.task(id)));
  const first = $derived(store.task(ids[0] ?? null));
  const many = $derived(ids.length > 1 ? ` ${ids.length} to-dos` : '');

  $effect(() => {
    input?.focus();
  });

  function fuzzy(text: string, query: string): boolean {
    if (!query) return true;
    const t = text.toLowerCase();
    let i = 0;
    for (const ch of query.toLowerCase()) {
      i = t.indexOf(ch, i);
      if (i < 0) return false;
      i++;
    }
    return true;
  }

  function dateItems(apply: (date: string | null, extra?: 'evening' | 'someday') => void, allowSomeday: boolean): Item[] {
    const d = store.day;
    const typed = q.trim() ? parseDateWord(q.trim().replace(/\s+/g, '-'), d) : null;
    const base: Item[] = [];
    if (typed) base.push({ label: `${relLabel(typed, d)}`, hint: longLabel(typed), run: () => apply(typed) });
    base.push(
      { label: 'Today', hint: longLabel(d), run: () => apply(d) },
      ...(allowSomeday ? [{ label: 'This Evening', hint: longLabel(d), run: () => apply(d, 'evening' as const) }] : []),
      { label: 'Tomorrow', hint: longLabel(addDays(d, 1)), run: () => apply(addDays(d, 1)) },
      { label: 'Next week', hint: longLabel(nextWeekday(d, 1)), run: () => apply(nextWeekday(d, 1)) },
      ...(allowSomeday ? [{ label: 'Someday', run: () => apply(null, 'someday' as const) }] : []),
      { label: allowSomeday ? 'Clear (Anytime)' : 'Clear deadline', run: () => apply(null) },
    );
    return typed ? base : base.filter((i) => fuzzy(i.label, q));
  }

  const items: Item[] = $derived.by(() => {
    switch (mode.kind) {
      case 'commands': {
        const cmds = commands
          .filter((c) => !c.hidden && (!c.when || c.when()))
          .map((c) => ({ label: c.title, hint: c.group, keys: c.keys[0] ? keyLabel(c.keys[0]) : undefined, run: c.run }));
        const lists: Item[] = [
          ...store.areas.map((a) => ({ label: `Go to ${a.name}`, hint: 'Area', run: () => store.go({ kind: 'area', id: a.id }) })),
          ...store.projects.filter((p) => !p.completed_at).map((p) => ({ label: `Go to ${p.name}`, hint: 'Project', run: () => store.go({ kind: 'project', id: p.id }) })),
        ];
        return [...cmds, ...lists].filter((i) => fuzzy(`${i.label} ${i.hint ?? ''}`, q));
      }
      case 'move': {
        if (!first) return [];
        const targets = ids;
        const moveTo = (name: string, target: Parameters<typeof store.moveTo>[1]) => {
          store.each(targets, 'move', (id) => store.moveTo(id, target));
          store.notify(`Moved${many} to ${name}`);
        };
        const toDump = (name: string, sectionId: string | null) => {
          store.each(targets, 'move', (id) => store.moveToDumpSection(id, sectionId));
          store.notify(`Moved${many} to ${name}`);
        };
        // Top-level lists first, only those turned on in Settings → Features. Upcoming and This Week
        // need a day, so they open When for the same to-dos.
        const toWhen = () => {
          store.paletteMode = { kind: 'when' };
          store.overlay = 'palette';
        };
        const out: Item[] = [
          { label: 'Inbox', hint: 'List', run: () => store.moveToList(targets, 'inbox') },
          { label: 'Today', hint: 'List', run: () => store.moveToList(targets, 'today') },
          ...(viewEnabled('week') ? [{ label: 'This Week', hint: 'List · pick a day', run: toWhen }] : []),
          { label: 'Upcoming', hint: 'List · pick a day', run: toWhen },
          { label: 'Anytime', hint: 'List', run: () => store.moveToList(targets, 'anytime') },
          { label: 'Someday', hint: 'List', run: () => store.moveToList(targets, 'someday') },
          ...(viewEnabled('dump') && !first.dump ? [{ label: 'Brain Dump', hint: 'List · deleted after 48h unless kept', run: () => store.moveToList(targets, 'dump') }] : []),
        ];
        for (const a of store.areas) {
          out.push({ label: a.name, hint: 'Area', run: () => moveTo(a.name, { area_id: a.id }) });
          for (const p of store.projects.filter((p) => p.area_id === a.id && !p.completed_at)) {
            out.push({ label: p.name, hint: `Project in ${a.name}`, run: () => moveTo(p.name, { project_id: p.id }) });
          }
        }
        for (const p of store.projects.filter((p) => !p.area_id && !p.completed_at)) {
          out.push({ label: p.name, hint: 'Project', run: () => moveTo(p.name, { project_id: p.id }) });
        }
        if (first.dump && viewEnabled('dump')) {
          out.push({ label: 'Brain Dump', hint: 'No section', run: () => toDump('Brain Dump', null) });
          for (const s of store.dumpSections) out.push({ label: `Brain Dump / ${s.name}`, hint: 'Section', run: () => toDump(`Brain Dump / ${s.name}`, s.id) });
        }
        return out.filter((i) => fuzzy(`${i.label} ${i.hint ?? ''}`, q));
      }
      case 'when': {
        if (!first) return [];
        const targets = ids;
        return dateItems((date, extra) => {
          store.each(targets, 'date change', (id) => store.setWhen(id, { date, evening: extra === 'evening', someday: extra === 'someday', inbox: false }));
          store.announceWhenMany(targets);
        }, true);
      }
      case 'deadline': {
        if (!first) return [];
        const targets = ids;
        return dateItems((date) => {
          store.each(targets, 'deadline change', (id) => store.update(id, { deadline: date }, 'deadline change'));
          store.notify(date ? `Deadline${many ? ` for${many}` : ''}: ${relLabel(date, store.day)}` : `Deadline cleared${many ? ` for${many}` : ''}`);
        }, false);
      }
      case 'tag': {
        if (!task) return [];
        const have = new Set(store.tagsFor(task.id).map((t) => t.id));
        const name = q.trim().replace(/^#/, '');
        const out: Item[] = store.tags
          .filter((t) => !have.has(t.id) && fuzzy(t.name, name))
          .map((t) => ({ label: `#${t.name}`, run: () => store.addTag(task.id, t.name) }));
        if (name && !store.tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
          out.push({ label: `Create #${name}`, run: () => store.addTag(task.id, name) });
        }
        return out;
      }
      case 'challenge': {
        const h = store.habits.find((x) => x.id === store.selectedId);
        if (!h) return [];
        const n = Number(q.trim().replace(/d(ays?)?$/i, ''));
        const out: Item[] = [];
        if (n > 0 && n <= 365) out.push({ label: `${n} days`, hint: 'starting today', run: () => store.setChallenge(h.id, n) });
        for (const d of [30, 60, 75, 90, 100]) {
          if (d !== n) out.push({ label: `${d} days`, hint: h.target_days === d ? 'current · restart today' : 'starting today', run: () => store.setChallenge(h.id, d) });
        }
        if (h.target_days) out.push({ label: 'No challenge', hint: 'open-ended habit', run: () => store.setChallenge(h.id, null) });
        return q.trim() && !(n > 0) ? out.filter((i) => fuzzy(i.label, q)) : out;
      }
      case 'schedule': {
        const h = store.habits.find((x) => x.id === store.selectedId);
        if (!h) return [];
        const current = scheduleToString(parseSchedule(h.schedule));
        const opt = (label: string, s: HabitSchedule): Item => ({
          label,
          hint: scheduleToString(s) === current ? 'current' : undefined,
          run: () => store.setHabitSchedule(h.id, s),
        });
        // Typed days: "mon wed fri" → those weekdays; "4x" → 4 times a week.
        const typed = q.trim().toLowerCase();
        const out: Item[] = [];
        const times = /^([1-7])\s*x/.exec(typed);
        if (times) out.push(opt(`${times[1]}× a week, any days`, parseSchedule(`times:${times[1]}`)));
        const names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const picked = [...new Set(typed.split(/[\s,]+/).map((w) => names.indexOf(w.slice(0, 3))).filter((i) => i >= 0))];
        if (picked.length && !times) out.push(opt('Only these days', parseSchedule(`days:${picked.sort().join(',')}`)));
        if (out.length) return out;
        return [
          opt('Every day', { kind: 'daily' }),
          opt('Weekdays (Mon–Fri)', { kind: 'days', days: [1, 2, 3, 4, 5] }),
          opt('6× a week, any days', { kind: 'times', perWeek: 6 }),
          opt('5× a week, any days', { kind: 'times', perWeek: 5 }),
          opt('4× a week, any days', { kind: 'times', perWeek: 4 }),
          opt('3× a week, any days', { kind: 'times', perWeek: 3 }),
          opt('Weekends', { kind: 'days', days: [0, 6] }),
        ].filter((i) => fuzzy(i.label, q));
      }
      case 'reminder': {
        if (!task) return [];
        const base = task.when_date && task.when_date > store.day ? task.when_date : store.day;
        const set = (iso: string | null) => () => {
          store.setReminder(task.id, iso);
          // Ask once, from this keypress/click, so the browser allows the prompt.
          if (iso && notifier.permission === 'default') void notifier.request();
        };
        const typed = q.trim() ? parseReminder(q.trim(), base) : null;
        const now = new Date();
        const at = (day: string, h: number, m = 0) => {
          const [y, mo, d] = day.split('-').map(Number);
          return new Date(y, mo - 1, d, h, m).toISOString();
        };
        const out: Item[] = [];
        if (typed) out.push({ label: reminderLabel(typed, store.day), hint: 'Set reminder', run: set(typed) });
        if (!q.trim()) {
          out.push({ label: 'In 1 hour', hint: reminderLabel(new Date(now.getTime() + 3_600_000).toISOString(), store.day), run: set(new Date(now.getTime() + 3_600_000).toISOString()) });
          if (base !== store.day) out.push({ label: 'That morning', hint: reminderLabel(at(base, 9), store.day), run: set(at(base, 9)) });
          if (now.getHours() < 18) out.push({ label: 'This evening', hint: reminderLabel(at(store.day, 18), store.day), run: set(at(store.day, 18)) });
          out.push({ label: 'Tomorrow morning', hint: reminderLabel(at(addDays(store.day, 1), 9), store.day), run: set(at(addDays(store.day, 1), 9)) });
          const monday = nextWeekday(store.day, 1) === addDays(store.day, 1) ? addDays(store.day, 8) : nextWeekday(store.day, 1);
          out.push({ label: 'Next week', hint: reminderLabel(at(monday, 9), store.day), run: set(at(monday, 9)) });
        }
        if (task.reminder_at) out.push({ label: 'Remove reminder', run: set(null) });
        return out;
      }
      case 'choose':
        return mode.options.filter((o) => fuzzy(`${o.label} ${o.hint ?? ''}`, q));
      case 'prompt':
        return [];
    }
  });

  $effect(() => {
    // Reset highlight when the list changes.
    void items.length;
    index = 0;
  });

  const placeholder = $derived.by(() => {
    switch (mode.kind) {
      case 'commands': return 'Type a command or list name…';
      case 'move': return many ? `Move${many} to…` : `Move “${first?.title ?? ''}” to…`;
      case 'when': return 'When? today, fri, in 3d, nov 3…';
      case 'deadline': return 'Deadline? fri, 2026-11-02…';
      case 'tag': return 'Tag name…';
      case 'challenge': return 'Challenge length in days (e.g. 75)…';
      case 'reminder': return 'Remind me… 6pm, in 30m, fri 9am';
      case 'schedule': return 'Schedule… or type days (mon wed fri) or 4x';
      case 'choose': return mode.label;
      case 'prompt': return mode.placeholder ?? mode.label;
    }
  });

  function close() {
    (document.activeElement as HTMLElement | null)?.blur();
    store.overlay = null;
    store.paletteMode = { kind: 'commands' };
  }

  function choose(i: number) {
    const m = mode;
    if (m.kind === 'prompt') {
      const v = q.trim();
      close();
      if (v) m.onSubmit(v);
      return;
    }
    const item = items[i];
    if (!item) return;
    close();
    item.run();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault();
      index = Math.min(items.length - 1, index + 1);
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault();
      index = Math.max(0, index - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(index);
    }
  }
</script>

<div class="scrim" transition:fade={{ duration: 120 }} onclick={close} onkeydown={() => {}} role="presentation"></div>
<div class="panel" transition:fly={{ y: -10, duration: 160 }} role="dialog" aria-modal="true" aria-label={placeholder}>
  {#if mode.kind === 'prompt' || mode.kind === 'choose'}<div class="label">{mode.label}</div>{/if}
  <input bind:this={input} bind:value={q} onkeydown={onKey} {placeholder} spellcheck="false" aria-label={placeholder} />
  {#if items.length}
    <ul role="listbox">
      {#each items as item, i (item.label + i)}
        <li role="option" aria-selected={i === index}>
          <button class:active={i === index} onmouseenter={() => (index = i)} onclick={() => choose(i)}>
            <span class="l">{item.label}</span>
            {#if item.hint}<span class="h">{item.hint}</span>{/if}
            {#if item.keys}<kbd>{item.keys}</kbd>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {:else if mode.kind === 'prompt'}
    <div class="empty"><kbd>↵</kbd> to create</div>
  {:else}
    <div class="empty">No matches</div>
  {/if}
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.18);
    z-index: 20;
  }
  .panel {
    position: fixed;
    top: 14vh;
    left: 50%;
    width: min(560px, 92vw);
    transform: translateX(-50%);
    background: var(--card);
    border-radius: 12px;
    box-shadow: var(--card-shadow), 0 0 0 1px var(--line);
    z-index: 21;
    overflow: hidden;
  }
  .label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-3);
    padding: 12px 16px 0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  input {
    width: 100%;
    border: none;
    outline: none;
    background: transparent;
    font-size: 16px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--line);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 6px;
    max-height: 50vh;
    overflow-y: auto;
  }
  li button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-radius: 7px;
    text-align: left;
  }
  li button.active {
    background: var(--select);
  }
  .l {
    flex: 1;
    font-weight: 500;
  }
  .h {
    font-size: 12px;
    color: var(--text-3);
  }
  .empty {
    padding: 14px 16px;
    color: var(--text-3);
    font-size: 13px;
  }
  @media (max-width: 760px) {
    .panel {
      top: calc(8px + env(safe-area-inset-top));
      width: calc(100vw - 16px);
    }
  }
</style>
