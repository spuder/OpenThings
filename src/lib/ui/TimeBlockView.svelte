<script lang="ts">
  /**
   * Time Blocking calendar (#99, prototype 1: web, OpenThings' own blocks only).
   *
   * Day / 3 days / 7 days: a time grid. Drag on empty space to create a block (live preview,
   * snapped to 15 minutes), drag a block to move it (also to another day), drag its top or bottom
   * edge to resize. On touch, long-press first, like dragging a to-do. A new block opens its inline
   * assignment box (BlockAssign) with no dialog. 4 weeks: a month-style overview; tap a day to open it.
   *
   * Written from scratch for this project. The decisions (snapping, layout, rules) are in timeblocks.ts.
   */
  import { store } from '../store.svelte';
  import { longLabel, relLabel, parseYmd } from '../dates';
  import * as TB from '../timeblocks';
  import type { ID, TimeBlock } from '../types';
  import BlockAssign from './BlockAssign.svelte';
  import CalendarTodos from './CalendarTodos.svelte';
  import { LONG_PRESS_MS } from './drag.svelte';
  import { calDrop, HOUR_PX } from './calendarDrop.svelte';

  /** Pixels per hour. */
  const HOUR = HOUR_PX;
  const PX_PER_MIN = HOUR / 60;
  /** Mouse travel before a press on a block becomes a move. */
  const DRAG_PX = 4;
  /** Touch: moving further than this before the long-press fires means scrolling. */
  const TOUCH_SLOP = 8;
  const EDGE = 40;

  const days = $derived(TB.rangeDays(store.calRange, store.calAnchor));
  const grid = $derived(store.calRange !== '4week');
  const nowMin = $derived.by(() => {
    const d = new Date(store.now);
    return d.getHours() * 60 + d.getMinutes();
  });

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const short = (d: string) => {
    const x = parseYmd(d);
    return `${MONTHS[x.getMonth()]} ${x.getDate()}`;
  };
  const period = $derived(days.length === 1 ? longLabel(days[0]) : `${short(days[0])} – ${short(days.at(-1)!)}`);

  // What a dragged area, project or to-do would become, shown as a preview where it would land.
  const dropBlock = $derived.by((): TimeBlock | null => {
    const link = calDrop.source ? TB.sourceBlock(calDrop.source, store.areas, store.projects, store.tasks) : null;
    if (!link || !calDrop.slot) return null;
    const { day, start, end } = calDrop.slot;
    return { id: '', start_at: TB.atTime(day, start), end_at: TB.atTime(day, end), title: link.title, ...link.assignment, calendar_id: null, created_at: '', deleted_at: null };
  });

  function label(b: TimeBlock) {
    return TB.blockLabel(b, store.areas, store.projects, store.tasks);
  }
  function color(b: TimeBlock) {
    return TB.blockColor(b.area_id, store.areas);
  }

  // ---------- pointer gestures ----------

  type Kind = 'create' | 'move' | 'start' | 'end';
  interface Gesture {
    kind: Kind;
    pointerId: number;
    mouse: boolean;
    blockId: ID | null;
    x0: number;
    y0: number;
    /** Minute under the pointer when it went down, and the block's span then. */
    min0: number;
    day0: string;
    span0: { start: number; end: number };
    /** Live result shown while dragging. */
    day: string;
    start: number;
    end: number;
    armed: boolean;
    active: boolean;
    timer?: ReturnType<typeof setTimeout>;
  }

  let g = $state<Gesture | null>(null);
  let scroller: HTMLElement | undefined = $state();
  let body: HTMLElement | undefined = $state();
  let lastY = 0;
  let lastX = 0;
  let endedAt = 0;

  function minuteAt(clientY: number): number {
    if (!body) return 0;
    return TB.clamp((clientY - body.getBoundingClientRect().top) / PX_PER_MIN, 0, TB.DAY_MIN);
  }

  function dayAt(clientX: number, fallback: string): string {
    const cols = body?.querySelectorAll<HTMLElement>('[data-day]') ?? [];
    for (const c of cols) {
      const r = c.getBoundingClientRect();
      if (clientX >= r.left && clientX < r.right) return c.dataset.day!;
    }
    return fallback;
  }

  function down(e: PointerEvent, kind: Kind, day: string, b?: TimeBlock) {
    if (e.button !== 0 || !e.isPrimary || g) return;
    if (e.target instanceof Element && e.target.closest('input, [data-no-drag]')) return;
    if (kind !== 'create') e.stopPropagation();
    // Pressing anywhere else closes an open assignment box, as Escape does.
    if (store.blockEditingId && store.blockEditingId !== b?.id) store.blockEditingId = null;
    const mouse = e.pointerType === 'mouse';
    const min0 = minuteAt(e.clientY);
    const span0 = b ? TB.blockSpan(b) : { start: min0, end: min0 };
    g = {
      kind,
      pointerId: e.pointerId,
      mouse,
      blockId: b?.id ?? null,
      x0: e.clientX,
      y0: e.clientY,
      min0,
      day0: day,
      span0: { start: span0.start, end: span0.end },
      day,
      start: span0.start,
      end: span0.end,
      armed: mouse,
      active: false,
    };
    if (!mouse) {
      g.timer = setTimeout(() => {
        if (!g) return;
        g.armed = true;
        g.active = true;
        navigator.vibrate?.(8);
        update(g.x0, g.y0);
        autoScroll();
      }, LONG_PRESS_MS);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
  }

  function update(x: number, y: number) {
    if (!g) return;
    lastX = x;
    lastY = y;
    const m = minuteAt(y);
    if (g.kind === 'create') {
      // The slot under the press, out to the slot under the pointer (a minute's leeway on the lines).
      const a = Math.floor((Math.min(g.min0, m) + 1) / TB.SNAP_MIN) * TB.SNAP_MIN;
      const b = Math.ceil((Math.max(g.min0, m) - 1) / TB.SNAP_MIN) * TB.SNAP_MIN;
      const s = TB.fitSpan(a, b);
      g.start = s.start;
      g.end = s.end;
    } else if (g.kind === 'move') {
      const s = TB.shiftSpan(g.span0.start, g.span0.end, m - g.min0);
      g.start = s.start;
      g.end = s.end;
      g.day = dayAt(x, g.day);
    } else if (g.kind === 'start') {
      g.start = TB.clamp(TB.snap(m), 0, g.span0.end - TB.MIN_BLOCK);
    } else {
      g.end = TB.clamp(TB.snap(m), g.span0.start + TB.MIN_BLOCK, TB.DAY_MIN);
    }
  }

  function move(e: PointerEvent) {
    if (!g || e.pointerId !== g.pointerId) return;
    const dist = Math.hypot(e.clientX - g.x0, e.clientY - g.y0);
    if (!g.active) {
      if (!g.armed) {
        if (dist > TOUCH_SLOP) finish(); // it's a scroll
        return;
      }
      if (dist < DRAG_PX) return;
      g.active = true;
      update(e.clientX, e.clientY);
      autoScroll();
      return;
    }
    update(e.clientX, e.clientY);
  }

  function up(e: PointerEvent) {
    if (!g || e.pointerId !== g.pointerId) return;
    const done = g;
    finish();
    if (!done.active) {
      // A click or tap on a block selects it and opens its box; on empty space it deselects.
      if (done.kind === 'create') {
        store.blockSelectedId = null;
      } else if (done.blockId) {
        store.blockSelectedId = done.blockId;
        store.blockEditingId = done.blockId;
      }
      return;
    }
    // Touch: a long-press that doesn't move makes a one-hour block where the finger is.
    if (done.kind === 'create' && !done.mouse && Math.abs(lastY - done.y0) < TOUCH_SLOP) store.addBlock(done.day, done.start, done.start + 60);
    else if (done.kind === 'create') store.addBlock(done.day, done.start, done.end);
    else if (done.blockId) {
      store.blockSelectedId = done.blockId;
      store.setBlockSpan(done.blockId, done.day, done.start, done.end);
    }
  }

  function cancel() {
    finish();
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape' && g) {
      e.preventDefault();
      e.stopPropagation();
      finish();
    }
  }

  function finish() {
    if (!g) return;
    clearTimeout(g.timer);
    if (g.active || g.armed) endedAt = Date.now();
    g = null;
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, true);
  }

  let raf = 0;
  /** Scroll the grid while dragging near its top or bottom edge. */
  function autoScroll() {
    cancelAnimationFrame(raf);
    if (!g?.active || !scroller) return;
    const r = scroller.getBoundingClientRect();
    const dy = lastY < r.top + EDGE + 36 ? -1 : lastY > r.bottom - EDGE ? 1 : 0;
    if (dy) {
      scroller.scrollBy(0, dy * 8);
      update(lastX, lastY);
    }
    raf = requestAnimationFrame(autoScroll);
  }

  /** Once a touch is held, moving it drags instead of scrolling; no callout on long-press. */
  function touchGuard(node: HTMLElement) {
    const touchmove = (e: TouchEvent) => {
      if (g?.armed && !g.mouse && e.cancelable) e.preventDefault();
    };
    const contextmenu = (e: Event) => {
      if (g && !g.mouse) e.preventDefault();
    };
    const click = (e: MouseEvent) => {
      if (Date.now() - endedAt < 400) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    node.addEventListener('touchmove', touchmove, { passive: false });
    node.addEventListener('contextmenu', contextmenu);
    node.addEventListener('click', click, true);
    return () => {
      finish();
      node.removeEventListener('touchmove', touchmove);
      node.removeEventListener('contextmenu', contextmenu);
      node.removeEventListener('click', click, true);
    };
  }

  // Open on the working day: scroll to 7:00, or earlier when it's earlier than that now.
  const openedAt = new Date().getHours() * 60 + new Date().getMinutes();
  $effect(() => {
    if (!scroller || !grid) return;
    scroller.scrollTop = Math.max(0, Math.min(7 * 60, openedAt - 60)) * PX_PER_MIN;
  });

  // Keep the keyboard-selected block in view.
  $effect(() => {
    const id = store.blockSelectedId;
    if (!id || !scroller) return;
    scroller.querySelector(`[data-block="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  });

  function openDay(day: string) {
    store.calAnchor = day;
    store.setCalRange('day');
  }

  function openBlock(b: TimeBlock) {
    openDay(TB.blockSpan(b).day);
    store.blockSelectedId = b.id;
    store.blockEditingId = b.id;
  }

  const hours = Array.from({ length: 24 }, (_, h) => h);
</script>

<div class="cal" data-no-swipe {@attach touchGuard}>
  <div class="toolbar">
    <div class="ranges" role="group" aria-label="Range">
      {#each TB.RANGES as r (r.id)}
        <button class:on={store.calRange === r.id} aria-pressed={store.calRange === r.id} onclick={() => store.setCalRange(r.id)} title={`${r.label} (${r.id === 'day' ? '1' : r.id === '3day' ? '3' : r.id === 'week' ? '7' : '4'})`}>
          <span class="long">{r.label}</span><span class="short">{r.short}</span>
        </button>
      {/each}
    </div>
    <span class="period">{period}</span>
    <div class="nav">
      <button onclick={() => store.stepCalendar(-1)} aria-label="Previous" title="Previous ([)">‹</button>
      <button class="today" onclick={() => store.calendarToday()} title="Today (T)">Today</button>
      <button onclick={() => store.stepCalendar(1)} aria-label="Next" title="Next (])">›</button>
    </div>
    <button class="panel-toggle" class:on={store.calPanel} aria-pressed={store.calPanel} onclick={() => store.toggleCalPanel()} title="Show / hide to-dos (L)">To-dos</button>
    <button class="add" onclick={() => store.addBlockNow()} aria-label="New time block" title="New time block (⇧B)">
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
    </button>
  </div>

  <div class="cal-body" class:with-panel={store.calPanel}>
  {#if store.calPanel}<CalendarTodos />{/if}
  <div class="cal-main">
  {#if grid}
    <div class="grid-scroll" bind:this={scroller} style:--n={days.length}>
      <div class="head">
        <span class="gutter"></span>
        {#each days as d (d)}
          <span class="dayname" class:is-today={d === store.day}>
            <small>{WD[parseYmd(d).getDay()]}</small>
            <strong>{parseYmd(d).getDate()}</strong>
            {#if days.length === 1}<em>{relLabel(d, store.day)}</em>{/if}
          </span>
        {/each}
      </div>
      <div class="body" bind:this={body} style:height={`${24 * HOUR}px`} style:--hour={`${HOUR}px`}>
        <div class="gutter">
          {#each hours as h}
            {#if h}<span class="hour" style:top={`${h * HOUR}px`}>{h}:00</span>{/if}
          {/each}
        </div>
        {#each days as d, di (d)}
          {@const placed = TB.layoutDay(TB.blocksOn(store.timeBlocks, d))}
          <div class="col" data-day={d} data-grid class:is-today={d === store.day} onpointerdown={(e) => down(e, 'create', d)} role="presentation">
            {#if d === store.day}
              <div class="now" style:top={`${nowMin * PX_PER_MIN}px`} aria-hidden="true"></div>
            {/if}
            {#each placed as p (p.block.id)}
              {@const b = p.block}
              {@const moving = g?.active && g.blockId === b.id}
              {@const l = label(b)}
              {@const editing = store.blockEditingId === b.id}
              <!-- An open box widens leftwards on the right of the grid, so it doesn't push the grid sideways. -->
              {@const flip = editing && (di + (p.lane + 1) / p.lanes) / days.length > 0.5}
              <div
                class="block"
                class:selected={store.blockSelectedId === b.id}
                class:editing
                class:ghosted={moving}
                class:generic={!b.area_id}
                class:tiny={p.end - p.start <= 30}
                data-block={b.id}
                style:top={`${p.start * PX_PER_MIN}px`}
                style:height={`${(p.end - p.start) * PX_PER_MIN}px`}
                style:left={flip ? 'auto' : `calc(${(p.lane / p.lanes) * 100}% + 2px)`}
                style:right={flip ? `calc(${(1 - (p.lane + 1) / p.lanes) * 100}% + 2px)` : null}
                style:width={`calc(${100 / p.lanes}% - 4px)`}
                style:--c={color(b)}
                onpointerdown={(e) => down(e, 'move', d, b)}
                role="button"
                tabindex="-1"
                aria-label={`${l.title || 'Block'} ${TB.spanLabel(p.start, p.end)}`}
              >
                <span class="edge top" onpointerdown={(e) => down(e, 'start', d, b)} role="presentation"></span>
                {#if l.crumbs.length && !editing}<span class="crumbs">{l.crumbs.join(' › ')}</span>{/if}
                {#if !editing}<span class="title">{l.title || 'Block'}</span>{/if}
                <span class="time">{TB.spanLabel(p.start, p.end)}</span>
                {#if editing}<BlockAssign block={b} />{/if}
                <span class="edge bottom" onpointerdown={(e) => down(e, 'end', d, b)} role="presentation"></span>
              </div>
            {/each}
            {#if dropBlock && calDrop.slot?.day === d}
              {@const l = label(dropBlock)}
              <div
                class="block preview"
                class:generic={!dropBlock.area_id}
                style:top={`${calDrop.slot.start * PX_PER_MIN}px`}
                style:height={`${(calDrop.slot.end - calDrop.slot.start) * PX_PER_MIN}px`}
                style:--c={color(dropBlock)}
                aria-hidden="true"
              >
                {#if l.crumbs.length}<span class="crumbs">{l.crumbs.join(' › ')}</span>{/if}
                <span class="title">{l.title || 'Block'}</span>
                <span class="time">{TB.spanLabel(calDrop.slot.start, calDrop.slot.end)}</span>
              </div>
            {/if}
            {#if g?.active && g.day === d}
              {@const b = g.blockId ? store.block(g.blockId) : undefined}
              <div
                class="block preview"
                class:generic={!b?.area_id}
                style:top={`${g.start * PX_PER_MIN}px`}
                style:height={`${(g.end - g.start) * PX_PER_MIN}px`}
                style:--c={b ? color(b) : 'var(--accent)'}
                aria-hidden="true"
              >
                {#if b}<span class="title">{label(b).title || 'Block'}</span>{/if}
                <span class="time">{TB.spanLabel(g.start, g.end)}</span>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {:else}
    <div class="month">
      {#each WD as w}<span class="wd">{w}</span>{/each}
      {#each days as d (d)}
        {@const list = TB.blocksOn(store.timeBlocks, d)}
        <div class="cell" data-day={d} class:is-today={d === store.day} class:past={d < store.day} class:drop={calDrop.slot?.day === d}>
          <button class="date" onclick={() => openDay(d)} title={`Open ${longLabel(d)}`}>{parseYmd(d).getDate() === 1 ? short(d) : parseYmd(d).getDate()}</button>
          {#each list.slice(0, 4) as b (b.id)}
            {@const s = TB.blockSpan(b)}
            <button class="chip" class:selected={store.blockSelectedId === b.id} style:--c={color(b)} onclick={() => openBlock(b)}>
              <span class="dot"></span><span class="chip-time">{TB.clock(s.start)}</span> {label(b).title || 'Block'}
            </button>
          {/each}
          {#if list.length > 4}<button class="more" onclick={() => openDay(d)}>+{list.length - 4} more</button>{/if}
        </div>
      {/each}
    </div>
  {/if}
  </div>
  </div>
  <p class="hint">Drag on the calendar to add a block{store.calRange === '4week' ? ' (open a day first)' : ''}, or drag in an area, project or to-do. ⇧B new block · ⇧C block time for a to-do.</p>
</div>

{#if calDrop.active && calDrop.source}
  {@const link = TB.sourceBlock(calDrop.source, store.areas, store.projects, store.tasks)}
  {@const name = link?.label || store.areas.find((a) => a.id === calDrop.source?.id)?.name || 'Block'}
  <div class="drop-ghost" class:over={!!calDrop.slot} style:transform={`translate(${calDrop.x + 14}px, ${calDrop.y + 10}px)`} aria-hidden="true">
    {name}{#if calDrop.slot}<span>&nbsp;· {TB.spanLabel(calDrop.slot.start, calDrop.slot.end)}</span>{/if}
  </div>
{/if}

<style>
  .cal {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .ranges,
  .nav {
    display: inline-flex;
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
  }
  .ranges button,
  .nav button {
    padding: 4px 10px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-2);
    min-height: 30px;
  }
  .ranges button + button,
  .nav button + button {
    border-left: 1px solid var(--line);
  }
  .ranges button.on {
    background: var(--select);
    color: var(--accent);
  }
  .ranges button:hover,
  .nav button:hover,
  .add:hover {
    background: var(--chip);
  }
  .short {
    display: none;
  }
  .period {
    font-weight: 600;
    color: var(--text-2);
    margin-right: auto;
  }
  .add {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    color: var(--accent);
    border: 1px solid var(--line);
  }

  .cal-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .cal-body.with-panel {
    grid-template-columns: 230px minmax(0, 1fr);
  }
  .cal-body.with-panel > :global(.todos) {
    height: max(420px, calc(100dvh - 230px));
    box-sizing: border-box;
  }
  .cal-main {
    min-width: 0;
  }
  .panel-toggle {
    padding: 4px 10px;
    min-height: 32px;
    border: 1px solid var(--line);
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-2);
  }
  .panel-toggle.on {
    background: var(--select);
    color: var(--accent);
  }
  .panel-toggle:hover {
    background: var(--chip);
  }
  .cell.drop {
    background: var(--select);
  }
  .drop-ghost {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 40;
    pointer-events: none;
    max-width: 280px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    background: var(--card);
    color: var(--text);
    box-shadow: var(--card-shadow), 0 0 0 1px var(--line);
    border-radius: 8px;
    padding: 6px 12px;
    font-size: 13px;
    font-weight: 600;
  }
  .drop-ghost span {
    color: var(--text-2);
    font-weight: 500;
  }
  .grid-scroll {
    position: relative;
    height: max(420px, calc(100dvh - 230px));
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: 10px;
    overscroll-behavior: contain;
  }
  .head,
  .body {
    display: grid;
    grid-template-columns: 44px repeat(var(--n), minmax(84px, 1fr));
    min-width: calc(44px + var(--n) * 84px);
  }
  .head {
    position: sticky;
    top: 0;
    z-index: 3;
    background: var(--bg);
    border-bottom: 1px solid var(--line);
  }
  .dayname {
    display: flex;
    align-items: baseline;
    gap: 5px;
    padding: 6px 8px;
    color: var(--text-2);
    border-left: 1px solid var(--line);
  }
  .dayname small {
    font-size: 11.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .dayname strong {
    font-size: 15px;
    color: var(--text);
  }
  .dayname em {
    font-style: normal;
    font-size: 12px;
    color: var(--text-3);
  }
  .dayname.is-today strong,
  .dayname.is-today small {
    color: var(--accent);
  }
  .body {
    position: relative;
  }
  .gutter {
    position: relative;
  }
  .hour {
    position: absolute;
    right: 6px;
    transform: translateY(-50%);
    font-size: 10.5px;
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .col {
    position: relative;
    border-left: 1px solid var(--line);
    background-image: repeating-linear-gradient(to bottom, var(--line) 0 1px, transparent 1px var(--hour));
    touch-action: pan-x pan-y;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    cursor: crosshair;
  }
  .col.is-today {
    background-color: color-mix(in srgb, var(--accent) 3%, transparent);
  }
  .now {
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--deadline);
    z-index: 2;
    pointer-events: none;
  }
  .now::before {
    content: '';
    position: absolute;
    left: -4px;
    top: -3px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--deadline);
  }

  .block {
    position: absolute;
    box-sizing: border-box;
    padding: 3px 6px;
    border-radius: 6px;
    overflow: hidden;
    background: color-mix(in srgb, var(--c) 16%, var(--bg));
    border-left: 3px solid var(--c);
    color: var(--text);
    font-size: 12px;
    line-height: 1.25;
    cursor: grab;
    display: flex;
    flex-direction: column;
    gap: 1px;
    transition: opacity 0.12s, box-shadow 0.12s;
    z-index: 1;
  }
  .block.generic {
    background: color-mix(in srgb, var(--text-3) 14%, var(--bg));
  }
  .block.selected {
    box-shadow: 0 0 0 2px var(--c);
    z-index: 2;
  }
  /* Room to type, even in a narrow overlap lane. */
  .block.editing {
    overflow: visible;
    z-index: 4;
    min-height: 60px;
    min-width: 180px;
  }

  .block.ghosted {
    opacity: 0.35;
  }
  .block.preview {
    z-index: 4;
    pointer-events: none;
    box-shadow: var(--card-shadow);
    opacity: 0.92;
    left: 2px;
    right: 2px;
  }
  .block.tiny:not(.editing) {
    flex-direction: row;
    gap: 6px;
    align-items: baseline;
  }
  .block.tiny .crumbs {
    display: none;
  }
  .crumbs {
    font-size: 10.5px;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .generic .title {
    color: var(--text-2);
  }
  .time {
    font-size: 10.5px;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .edge {
    position: absolute;
    left: 0;
    right: 0;
    height: 7px;
    cursor: ns-resize;
    z-index: 1;
  }
  .edge.top {
    top: 0;
  }
  .edge.bottom {
    bottom: 0;
  }

  .month {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
  }
  .wd {
    padding: 6px 8px;
    font-size: 11.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-3);
    border-bottom: 1px solid var(--line);
  }
  .cell {
    min-height: 104px;
    padding: 4px;
    border-top: 1px solid var(--line);
    border-left: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .cell:nth-child(7n + 1) {
    border-left: none;
  }
  .cell.past {
    background: color-mix(in srgb, var(--chip) 45%, transparent);
  }
  .date {
    align-self: flex-start;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-2);
    padding: 1px 6px;
    border-radius: 10px;
  }
  .cell.is-today .date {
    background: var(--accent);
    color: var(--bg);
  }
  .chip,
  .more {
    display: block;
    text-align: left;
    font-size: 11.5px;
    padding: 2px 4px;
    border-radius: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text);
  }
  .chip:hover,
  .date:hover,
  .more:hover {
    background: var(--chip);
  }
  .chip.selected {
    background: var(--select);
  }
  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--c);
    margin-right: 3px;
  }
  .chip-time {
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .more {
    color: var(--text-3);
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--text-3);
  }

  @media (pointer: coarse) {
    .edge {
      height: 14px;
    }
    .ranges button,
    .nav button,
    .add {
      min-height: 44px;
      min-width: 44px;
    }
    .chip,
    .more {
      min-height: 28px;
    }
    .hint {
      display: none;
    }
  }
  @media (max-width: 760px) {
    .long {
      display: none;
    }
    .short {
      display: inline;
    }
    .period {
      order: 3;
      width: 100%;
    }
    .cal-body.with-panel {
      grid-template-columns: minmax(0, 1fr);
    }
    .cal-body.with-panel > :global(.todos) {
      height: auto;
      max-height: 34dvh;
    }
    .grid-scroll {
      height: max(380px, calc(100dvh - 250px));
    }
    .cell {
      min-height: 72px;
    }
    .hint {
      display: none;
    }
    .chip-time {
      display: none;
    }
  }
</style>
