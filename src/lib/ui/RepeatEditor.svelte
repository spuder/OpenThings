<script lang="ts">
  import { untrack } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { store } from '../store.svelte';
  import { addDays, parseYmd, relLabel } from '../dates';
  import { isMac } from '../commands';
  import { DAY_LONG, DAY_SHORT, describe, emptyRule, formatRule, MONTH_SHORT, ordinal, parseRule, previewDates, WEEKDAYS, type Freq, type Rule } from '../rrule';
  import Icon from './Icon.svelte';

  /**
   * Repeat editor for the selected to-do: opened by the task.repeat command (⇧W), the to-do's repeat
   * button, its repeat chip, or its right-click menu. Builds an RRULE (see rrule.ts) and saves it through
   * store.setRepeat. Works as a centred dialog on desktop and a bottom sheet on phones.
   */

  const task = store.task(store.selectedId);
  const initial = parseRule(task?.rrule);
  const start0 = task?.when_date ?? store.day;
  const s0 = parseYmd(start0);

  const FREQS: { id: Freq; label: string; one: string; many: string }[] = [
    { id: 'DAILY', label: 'Daily', one: 'day', many: 'days' },
    { id: 'WEEKLY', label: 'Weekly', one: 'week', many: 'weeks' },
    { id: 'MONTHLY', label: 'Monthly', one: 'month', many: 'months' },
    { id: 'YEARLY', label: 'Yearly', one: 'year', many: 'years' },
  ];
  /** Monday first. */
  const WEEK = [1, 2, 3, 4, 5, 6, 0];
  const ORDINALS = [1, 2, 3, 4, 5, -1];
  /** 7 stands for "weekday" (Mon–Fri, by BYSETPOS). */
  const WEEKDAY_ANY = 7;

  let freq = $state<Freq>(initial?.freq ?? 'WEEKLY');
  let interval = $state(initial?.interval ?? 1);
  let start = $state(start0);
  let weekDays = $state<number[]>(initial?.freq === 'WEEKLY' && initial.byDay.length ? [...new Set(initial.byDay.map((d) => d.day))] : [s0.getDay()]);

  const initialOrdinal = initial?.freq === 'MONTHLY' && initial.byDay.length > 0;
  let monthMode = $state<'days' | 'weekday'>(initialOrdinal ? 'weekday' : 'days');
  let monthDays = $state<number[]>(initial?.freq === 'MONTHLY' && initial.byMonthDay.length ? [...initial.byMonthDay] : [s0.getDate() === 31 ? -1 : s0.getDate()]);
  let ordN = $state(
    initialOrdinal ? (initial!.bySetPos[0] ?? initial!.byDay[0].n) || 1 : Math.ceil(s0.getDate() / 7) > 4 ? -1 : Math.ceil(s0.getDate() / 7),
  );
  let ordDay = $state(initialOrdinal ? (initial!.byDay.length > 1 ? WEEKDAY_ANY : initial!.byDay[0].day) : s0.getDay());

  let end = $state<'never' | 'count' | 'until'>(initial?.count ? 'count' : initial?.until ? 'until' : 'never');
  let count = $state(initial?.count ?? 10);
  let until = $state(initial?.until ?? addDays(start0, 90));

  const clampInt = (v: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.floor(Number(v)) || lo));

  const rule: Rule = $derived.by(() => {
    const r = emptyRule(freq);
    r.interval = clampInt(interval, 1, 999);
    const s = parseYmd(start || store.day);
    if (freq === 'WEEKLY') r.byDay = (weekDays.length ? weekDays : [s.getDay()]).map((day) => ({ day, n: 0 }));
    if (freq === 'MONTHLY') {
      if (monthMode === 'days') r.byMonthDay = monthDays.length ? [...monthDays] : [s.getDate()];
      else if (ordDay === WEEKDAY_ANY) {
        r.byDay = WEEKDAYS.map((day) => ({ day, n: 0 }));
        r.bySetPos = [ordN];
      } else r.byDay = [{ day: ordDay, n: ordN }];
    }
    if (freq === 'YEARLY') {
      r.byMonth = [s.getMonth() + 1];
      r.byMonthDay = [s.getDate()];
    }
    if (end === 'count') r.count = clampInt(count, 1, 999);
    if (end === 'until' && until) r.until = until;
    return r;
  });

  const label = $derived(describe(rule, store.day));
  const PREVIEW = 5;
  const dates = $derived(previewDates(rule, start || store.day, PREVIEW));
  const ends = $derived(end !== 'never' && dates.length < PREVIEW);
  /** The saved rule had parts this editor doesn't show; saving rewrites it. */
  const custom = untrack(() => !!initial && formatRule(initial) !== formatRule(rule));

  const unit = $derived(FREQS.find((f) => f.id === freq)!);

  function dateLabel(d: string) {
    const x = parseYmd(d);
    const year = x.getFullYear() !== parseYmd(store.day).getFullYear() ? ` ${x.getFullYear()}` : '';
    return `${DAY_SHORT[x.getDay()]} ${MONTH_SHORT[x.getMonth()]} ${x.getDate()}${year}`;
  }
  function near(d: string) {
    const r = relLabel(d, store.day);
    return r === 'Today' || r === 'Tomorrow' ? r : '';
  }

  function toggle(list: number[], v: number): number[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  function close() {
    (document.activeElement as HTMLElement | null)?.blur();
    store.overlay = null;
  }
  function save() {
    if (task) store.setRepeat(task.id, formatRule(rule), start || store.day);
    close();
  }
  function remove() {
    if (task) store.setRepeat(task.id, null);
    close();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  }
  function fieldEnter(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      save();
    }
  }

  /** Arrow keys move along a segmented control, like a radio group. */
  function segKeys(e: KeyboardEvent, options: string[], current: string, set: (v: string) => void) {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = (options.indexOf(current) + d + options.length) % options.length;
    set(options[i]);
    const group = (e.currentTarget as HTMLElement).closest('[role="radiogroup"]');
    queueMicrotask(() => (group?.querySelectorAll<HTMLElement>('[role="radio"]')[i])?.focus());
  }

  let panel: HTMLElement | undefined = $state();
  $effect(() => {
    if (!task) store.overlay = null;
    // Start on the frequency control: arrows change it, Tab walks the rest.
    panel?.querySelector<HTMLElement>('.seg [aria-checked="true"]')?.focus();
  });

  const modKey = isMac ? '⌘' : 'Ctrl';
</script>

<svelte:window onkeydown={onKey} />

{#snippet segment(name: string, options: { id: string; label: string }[], current: string, set: (v: string) => void)}
  <div class="seg" role="radiogroup" aria-label={name}>
    {#each options as o (o.id)}
      <button
        role="radio"
        aria-checked={o.id === current}
        class:on={o.id === current}
        tabindex={o.id === current ? 0 : -1}
        onclick={() => set(o.id)}
        onkeydown={(e) => segKeys(e, options.map((x) => x.id), current, set)}>{o.label}</button>
    {/each}
  </div>
{/snippet}

{#if task}
  <div class="scrim" transition:fade={{ duration: 120 }} onclick={close} onkeydown={() => {}} role="presentation"></div>
  <div class="panel" bind:this={panel} transition:fly={{ y: 14, duration: 180 }} role="dialog" aria-modal="true" aria-labelledby="repeat-title">
    <header>
      <span class="icon"><Icon name="repeat" size={18} /></span>
      <div class="head-text">
        <h2 id="repeat-title">Repeat</h2>
        <div class="task-title">{task.title}</div>
      </div>
    </header>

    <div class="body">
      <div class="field">
        <span class="label">Frequency</span>
        {@render segment('Frequency', FREQS, freq, (v) => (freq = v as Freq))}
      </div>

      <div class="field">
        <label class="label" for="repeat-interval">Every</label>
        <div class="inline">
          <input id="repeat-interval" class="num" type="number" inputmode="numeric" min="1" max="999" bind:value={interval} onkeydown={fieldEnter} />
          <span class="unit">{clampInt(interval, 1, 999) === 1 ? unit.one : unit.many}</span>
        </div>
      </div>

      {#if freq === 'WEEKLY'}
        <div class="field">
          <span class="label" id="repeat-days">On</span>
          <div class="days" role="group" aria-labelledby="repeat-days">
            {#each WEEK as d (d)}
              <button class="day" class:on={weekDays.includes(d)} aria-pressed={weekDays.includes(d)} aria-label={DAY_LONG[d]} title={DAY_LONG[d]} onclick={() => (weekDays = toggle(weekDays, d))}>{DAY_SHORT[d].slice(0, 2)}</button>
            {/each}
          </div>
        </div>
      {:else if freq === 'MONTHLY'}
        <div class="field">
          <span class="label">On</span>
          <div class="stack">
            {@render segment('Monthly by', [{ id: 'days', label: 'Days of the month' }, { id: 'weekday', label: 'A weekday' }], monthMode, (v) => (monthMode = v as 'days' | 'weekday'))}
            {#if monthMode === 'days'}
              <div class="month" role="group" aria-label="Days of the month">
                {#each Array.from({ length: 31 }, (_, i) => i + 1) as d (d)}
                  <button class="md" class:on={monthDays.includes(d)} aria-pressed={monthDays.includes(d)} aria-label={ordinal(d)} onclick={() => (monthDays = toggle(monthDays, d))}>{d}</button>
                {/each}
                <button class="md last" class:on={monthDays.includes(-1)} aria-pressed={monthDays.includes(-1)} onclick={() => (monthDays = toggle(monthDays, -1))}>Last day</button>
              </div>
            {:else}
              <div class="inline">
                <span class="the">The</span>
                <select bind:value={ordN} aria-label="Which one" onkeydown={fieldEnter}>
                  {#each ORDINALS as n (n)}<option value={n}>{n === -1 ? 'last' : ordinal(n)}</option>{/each}
                </select>
                <select bind:value={ordDay} aria-label="Day of the week" onkeydown={fieldEnter}>
                  {#each WEEK as d (d)}<option value={d}>{DAY_LONG[d]}</option>{/each}
                  <option value={WEEKDAY_ANY}>weekday</option>
                </select>
              </div>
            {/if}
          </div>
        </div>
      {:else if freq === 'YEARLY'}
        <div class="field">
          <span class="label">On</span>
          <span class="static">{MONTH_SHORT[parseYmd(start || store.day).getMonth()]} {parseYmd(start || store.day).getDate()}, from the start date</span>
        </div>
      {/if}

      <div class="field">
        <label class="label" for="repeat-start">Starts</label>
        <input id="repeat-start" class="date" type="date" bind:value={start} onkeydown={fieldEnter} />
      </div>

      <div class="field">
        <span class="label">Ends</span>
        <div class="stack">
          {@render segment('Ends', [{ id: 'never', label: 'Never' }, { id: 'count', label: 'After' }, { id: 'until', label: 'On a date' }], end, (v) => (end = v as 'never' | 'count' | 'until'))}
          {#if end === 'count'}
            <div class="inline">
              <input class="num" type="number" inputmode="numeric" min="1" max="999" bind:value={count} aria-label="Number of times" onkeydown={fieldEnter} />
              <span class="unit">{clampInt(count, 1, 999) === 1 ? 'time' : 'times'}</span>
            </div>
          {:else if end === 'until'}
            <input class="date" type="date" bind:value={until} min={start} aria-label="Last date" onkeydown={fieldEnter} />
          {/if}
        </div>
      </div>
    </div>

    <section class="preview" aria-live="polite">
      <div class="summary">{label}</div>
      {#if dates.length}
        <ol>
          {#each dates as d, i (d)}
            <li><span class="n">{i + 1}</span>{dateLabel(d)}{#if near(d)}<span class="near">{near(d)}</span>{/if}</li>
          {/each}
          {#if ends}<li class="stop">Then it stops</li>{/if}
        </ol>
      {:else}
        <p class="none">No dates: the end date is before the start.</p>
      {/if}
      {#if custom}<p class="note">This to-do had a repeat this editor can’t show in full. Saving replaces it.</p>{/if}
    </section>

    <footer>
      {#if task.rrule}
        <button class="btn remove" onclick={remove}>Stop repeating</button>
      {/if}
      <span class="hint">{modKey}↵ save · Esc cancel</span>
      <button class="btn" onclick={close}>Cancel</button>
      <button class="btn primary" onclick={save} disabled={!dates.length}>Save</button>
    </footer>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.18);
    z-index: 20;
  }
  .panel {
    position: fixed;
    top: 9vh;
    left: 50%;
    width: min(520px, 94vw);
    max-height: 84vh;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    background: var(--card);
    border-radius: 12px;
    box-shadow: var(--card-shadow), 0 0 0 1px var(--line);
    z-index: 21;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 18px 12px;
    border-bottom: 1px solid var(--line);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 9px;
    color: var(--accent);
    background: var(--accent-soft);
    flex-shrink: 0;
  }
  .head-text {
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .task-title {
    font-size: 12.5px;
    color: var(--text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .body {
    padding: 8px 18px 4px;
    overflow-y: auto;
  }
  .field {
    display: grid;
    grid-template-columns: 82px 1fr;
    align-items: start;
    gap: 10px;
    padding: 8px 0;
  }
  .label {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-2);
    padding-top: 6px;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;
    min-width: 0;
  }
  .inline {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .seg {
    display: inline-flex;
    background: var(--chip);
    border-radius: 8px;
    padding: 2px;
    gap: 2px;
    max-width: 100%;
  }
  .seg button {
    padding: 4px 11px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--text-2);
    white-space: nowrap;
    transition: background 0.12s, color 0.12s;
  }
  .seg button:hover {
    color: var(--text);
  }
  .seg button.on {
    background: var(--card);
    color: var(--text);
    font-weight: 600;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }
  input.num,
  input.date,
  select {
    border: 1px solid var(--line-strong);
    border-radius: 7px;
    background: var(--bg);
    padding: 4px 8px;
    font-size: 13.5px;
    height: 30px;
    outline: none;
  }
  input.num {
    width: 64px;
  }
  input:focus-visible,
  select:focus-visible,
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .unit,
  .the,
  .static {
    font-size: 13.5px;
    color: var(--text-2);
  }
  .static {
    padding-top: 6px;
  }
  .days {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .day {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-2);
    background: var(--chip);
    transition: background 0.12s, color 0.12s, transform 0.12s var(--ease);
  }
  .day:active,
  .md:active {
    transform: scale(0.94);
  }
  .day.on,
  .md.on {
    background: var(--accent);
    color: #fff;
  }
  .month {
    display: grid;
    grid-template-columns: repeat(7, 34px);
    gap: 4px;
  }
  .md {
    height: 30px;
    border-radius: 7px;
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
    color: var(--text-2);
    background: var(--chip);
  }
  .md.last {
    grid-column: span 4;
  }
  .preview {
    margin: 6px 18px 0;
    padding: 12px 14px;
    border-radius: 9px;
    background: var(--chip);
  }
  .summary {
    font-weight: 600;
    font-size: 13.5px;
    color: var(--accent);
    margin-bottom: 6px;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 6px;
  }
  ol li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    background: var(--card);
    border-radius: 6px;
    padding: 3px 8px 3px 4px;
    font-variant-numeric: tabular-nums;
  }
  .n {
    display: grid;
    place-items: center;
    min-width: 16px;
    height: 16px;
    border-radius: 4px;
    font-size: 10.5px;
    font-weight: 600;
    color: var(--text-3);
    background: var(--chip);
  }
  .near {
    color: var(--text-3);
  }
  ol li.stop {
    background: transparent;
    color: var(--text-3);
    padding-left: 2px;
  }
  .none,
  .note {
    margin: 0;
    font-size: 12.5px;
    color: var(--text-3);
  }
  .note {
    margin-top: 8px;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 18px 16px;
  }
  .hint {
    flex: 1;
    min-width: 0;
    text-align: right;
    font-size: 12px;
    color: var(--text-3);
  }
  .btn {
    padding: 6px 14px;
    border-radius: 8px;
    font-size: 13.5px;
    font-weight: 500;
    color: var(--text-2);
  }
  .btn:hover {
    background: var(--chip);
    color: var(--text);
  }
  .btn.primary {
    background: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  .btn.primary:disabled {
    opacity: 0.4;
  }
  .btn.remove {
    color: var(--deadline);
    padding-left: 8px;
    padding-right: 8px;
  }

  /* Phone: a bottom sheet in thumb reach, every target 44px. */
  @media (max-width: 760px) {
    .panel {
      top: auto;
      bottom: 0;
      left: 0;
      width: 100%;
      max-height: calc(100dvh - env(safe-area-inset-top) - 24px);
      transform: none;
      border-radius: 14px 14px 0 0;
    }
    header {
      padding: 14px 16px 10px;
    }
    .body {
      padding: 4px 16px 0;
    }
    .field {
      grid-template-columns: 1fr;
      gap: 6px;
      padding: 8px 0;
    }
    .label {
      padding-top: 0;
    }
    .seg {
      width: 100%;
    }
    .seg button {
      flex: 1;
      min-height: 40px;
      font-size: 14px;
      padding: 0 6px;
    }
    input.num,
    input.date,
    select {
      height: 44px;
      font-size: 16px;
    }
    input.num {
      width: 76px;
    }
    .days {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 6px;
      width: 100%;
    }
    .day {
      width: 100%;
      height: 44px;
      border-radius: 12px;
      font-size: 14px;
    }
    .month {
      width: 100%;
      grid-template-columns: repeat(7, 1fr);
      gap: 5px;
    }
    .md {
      height: 44px;
      font-size: 14px;
    }
    .preview {
      margin: 8px 16px 0;
    }
    .hint {
      visibility: hidden;
    }
    footer {
      padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
    }
    footer .btn {
      min-height: 44px;
      font-size: 15px;
    }
  }
</style>
