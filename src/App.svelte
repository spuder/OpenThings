<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { store } from './lib/store.svelte';
  import { commands, handleKey, openListMenu } from './lib/commands';
  import { formatDuration, longLabel } from './lib/dates';
  import Sidebar from './lib/ui/Sidebar.svelte';
  import TaskList from './lib/ui/TaskList.svelte';
  import DumpView from './lib/ui/DumpView.svelte';
  import HabitsView from './lib/ui/HabitsView.svelte';
  import MatrixView from './lib/ui/MatrixView.svelte';
  import QuickAdd from './lib/ui/QuickAdd.svelte';
  import Palette from './lib/ui/Palette.svelte';
  import Help from './lib/ui/Help.svelte';
  import Icon from './lib/ui/Icon.svelte';
  import ProgressPie from './lib/ui/ProgressPie.svelte';
  import SyncBadge from './lib/ui/SyncBadge.svelte';
  import SettingsView from './lib/ui/SettingsView.svelte';
  import TrashView from './lib/ui/TrashView.svelte';
  import FocusView from './lib/ui/FocusView.svelte';
  import BottomBar from './lib/ui/BottomBar.svelte';
  import QuickFind from './lib/ui/QuickFind.svelte';
  import { isNarrow } from './lib/env';
  import { classifySwipe, swipeIgnored } from './lib/gesture';
  import { installKeyboardInset } from './lib/keyboard';

  store.init().then(() => store.start());
  installKeyboardInset();

  // Phone: swipe right anywhere to open the list drawer, swipe left to close it.
  // Pull down while the list is scrolled to the top to open Quick Find.
  let touch: { x: number; y: number; t: number; atTop: boolean } | null = null;
  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1 || !isNarrow() || store.overlay || swipeIgnored(e.target)) {
      touch = null;
      return;
    }
    const scroller = e.target instanceof Element ? e.target.closest('main .scroll') : null;
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: e.timeStamp, atTop: !!scroller && scroller.scrollTop <= 0 };
  }
  function onTouchEnd(e: TouchEvent) {
    if (!touch) return;
    const p = e.changedTouches[0];
    const swipe = classifySwipe(p.clientX - touch.x, p.clientY - touch.y, e.timeStamp - touch.t);
    const atTop = touch.atTop;
    touch = null;
    if (swipe === 'right' && !store.sidebarOpen) store.sidebarOpen = true;
    else if (swipe === 'left' && store.sidebarOpen) store.sidebarOpen = false;
    else if (swipe === 'down' && atTop && !store.sidebarOpen) commands.find((c) => c.id === 'app.find')?.run();
  }

  // Tapping or clicking outside an open to-do closes it. A drag (scrolling) doesn't count.
  let outside: { x: number; y: number } | null = null;
  function onPointerDown(e: PointerEvent) {
    const t = e.target instanceof Element ? e.target : null;
    outside = store.expandedId && !store.overlay && t && !t.closest('.task.expanded, [role="dialog"], [role="menu"]')
      ? { x: e.clientX, y: e.clientY }
      : null;
  }
  function onPointerUp(e: PointerEvent) {
    if (!outside) return;
    const moved = Math.hypot(e.clientX - outside.x, e.clientY - outside.y);
    outside = null;
    if (moved > 10 || !store.expandedId) return;
    // Blur first so the open to-do's fields save, as Escape does.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('.task.expanded')) active.blur();
    store.expandedId = null;
  }

  const v = $derived(store.view);
  const iconName = $derived(v.kind === 'project' ? '' : v.kind);
  const project = $derived(v.kind === 'project' ? store.projects.find((p) => p.id === v.id) : undefined);
  const trackedTask = $derived(store.task(store.tracking?.taskId ?? null));

  const empty: Record<string, string> = {
    inbox: 'Inbox zero. Press Q to capture something.',
    today: 'Nothing scheduled for today.',
    upcoming: 'Nothing scheduled in the next 30 days.',
    anytime: 'No open to-dos.',
    someday: 'No someday ideas yet.',
    logbook: 'Nothing completed yet.',
    project: 'No to-dos in this project. Press Q to add one.',
    area: 'Nothing in this area yet.',
  };
</script>

<svelte:window onkeydown={handleKey} ontouchstart={onTouchStart} ontouchend={onTouchEnd} ontouchcancel={() => (touch = null)} onpointerdown={onPointerDown} onpointerup={onPointerUp} onpointercancel={() => (outside = null)} />

{#if store.ready}
  <div class="app">
    <Sidebar />
    {#if store.sidebarOpen}
      <div class="drawer-scrim" transition:fade={{ duration: 150 }} onclick={() => (store.sidebarOpen = false)} onkeydown={() => {}} role="presentation"></div>
    {/if}
    <main>
      <div class="status">
        <button class="menu-btn" onclick={() => store.toggleSidebar()} aria-label="Show or hide lists" title="Show / hide sidebar (Ctrl/⌘ /)">
          <svg viewBox="0 0 20 20" width="22" height="22" aria-hidden="true"><path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
        </button>
        <span class="spacer"></span>
        {#if store.pomodoro}
          <button class="pill pomo" onclick={() => store.cancelPomodoro()} title="Cancel Pomodoro (⇧P)" transition:fade>
            ◷ {formatDuration(store.pomodoro.endsAt - store.now)}
          </button>
        {/if}
        {#if store.focus && store.overlay !== 'focus'}
          <button class="pill focus-pill" class:brk={store.focus.phase === 'break'} onclick={() => (store.overlay = 'focus')} title="Back to focus (F)" transition:fade>
            {store.focus.phase === 'work' ? 'Focus' : 'Break'} {formatDuration(store.focusRemaining())}{store.focus.endsAt ? '' : ' · paused'}
          </button>
        {/if}
        {#if store.tracking && trackedTask && !store.focus}
          <button class="pill live" onclick={() => store.stopTracking()} title="Stop timer (⇧X)" transition:fade>
            <span class="dot"></span>{trackedTask.title} · {formatDuration(store.now - store.tracking.start)}
          </button>
        {/if}
        <SyncBadge compact />
        <button class="palette-btn" onclick={() => { store.paletteMode = { kind: 'commands' }; store.overlay = 'palette'; }}>
          <Icon name="search" size={14} /> <span class="palette-label">Commands</span> <kbd>{navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
      </div>

      <div class="scroll">
        <div class="content" class:wide={v.kind === 'matrix' || v.kind === 'habits'}>
          {#key store.view}
            <header class="view-head" in:fly={{ y: 6, duration: 200 }}>
              {#if project}
                <ProgressPie value={store.projectProgress(project.id)} size={26} />
              {:else}
                <Icon name={iconName} size={28} />
              {/if}
              <h1>{store.viewTitle}</h1>
              {#if v.kind === 'today'}<span class="date">{longLabel(store.day)}</span>{/if}
              {#if v.kind === 'area' || v.kind === 'project'}
                <button class="head-more" onclick={() => openListMenu({ kind: v.kind as 'area' | 'project', id: (v as { id: string }).id })} title="Rename, move, delete (⇧L)" aria-label="List actions">⋯</button>
              {/if}
            </header>
            {#if project?.notes}<p class="notes">{project.notes}</p>{/if}

            <div in:fade={{ duration: 160 }}>
              {#if v.kind === 'dump'}
                <DumpView />
              {:else if v.kind === 'habits'}
                <HabitsView />
              {:else if v.kind === 'matrix'}
                <MatrixView />
              {:else if v.kind === 'trash'}
                <TrashView />
              {:else if v.kind === 'settings'}
                <SettingsView />
              {:else}
                <TaskList
                  groups={store.groups}
                  showWhen={['anytime', 'someday', 'project', 'area', 'inbox'].includes(v.kind)}
                  showContainer={['today', 'upcoming', 'logbook', 'inbox', 'anytime'].includes(v.kind)}
                  empty={empty[v.kind]}
                />
              {/if}
            </div>
          {/key}
        </div>
      </div>

      <BottomBar />
    </main>
  </div>

  {#if store.overlay === 'quickadd'}<QuickAdd />{/if}
  {#if store.overlay === 'palette'}<Palette />{/if}
  {#if store.overlay === 'help'}<Help />{/if}
  {#if store.overlay === 'focus'}<FocusView />{/if}
  {#if store.overlay === 'find'}<QuickFind />{/if}

  {#if store.toast}
    {#key store.toast.id}
      <div class="toast" in:fly={{ y: 10, duration: 160 }} out:fade={{ duration: 200 }}>{store.toast.text}</div>
    {/key}
  {/if}
{:else}
  <div class="loading">Opening database…</div>
{/if}

<style>
  .app {
    display: flex;
    height: 100vh;
  }
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    position: relative;
  }
  .status {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding: 10px 18px 0;
    min-height: 40px;
  }
  .pill {
    font-size: 12px;
    font-weight: 600;
    border-radius: 14px;
    padding: 3px 10px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 320px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .pill.live {
    color: var(--logbook);
    background: color-mix(in srgb, var(--logbook) 12%, transparent);
  }
  .pill.focus-pill {
    color: var(--deadline);
    background: color-mix(in srgb, var(--deadline) 12%, transparent);
    font-variant-numeric: tabular-nums;
  }
  .pill.focus-pill.brk {
    color: var(--logbook);
    background: color-mix(in srgb, var(--logbook) 12%, transparent);
  }
  .pill.pomo {
    color: var(--deadline);
    background: color-mix(in srgb, var(--deadline) 12%, transparent);
    font-variant-numeric: tabular-nums;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    animation: blink 1.4s infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.3;
    }
  }
  .palette-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-2);
    border: 1px solid var(--line);
    border-radius: 7px;
    padding: 3px 4px 3px 9px;
  }
  .palette-btn:hover {
    background: var(--chip);
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
  }
  .content {
    max-width: 760px;
    margin: 0 auto;
    padding: 18px 56px 48px;
  }
  .content.wide {
    max-width: 1080px;
  }
  .view-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 22px 0 18px;
  }
  h1 {
    margin: 0;
    font-size: 27px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .date {
    font-size: 13px;
    color: var(--text-3);
    margin-left: 4px;
    align-self: flex-end;
    padding-bottom: 5px;
  }
  .head-more {
    margin-left: auto;
    width: 34px;
    height: 34px;
    border-radius: 8px;
    font-size: 20px;
    line-height: 1;
    color: var(--text-2);
  }
  .head-more:hover {
    background: var(--chip);
  }
  .notes {
    color: var(--text-2);
    margin: -8px 0 16px 40px;
    font-size: 13.5px;
  }
  .toast {
    position: fixed;
    bottom: 28px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--text);
    color: var(--bg);
    padding: 8px 16px;
    border-radius: 9px;
    font-size: 13px;
    font-weight: 500;
    z-index: 30;
    box-shadow: var(--card-shadow);
  }
  .menu-btn {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    margin-right: auto;
    border-radius: 8px;
    color: var(--text-3);
  }
  .menu-btn:hover {
    background: var(--chip);
    color: var(--text-2);
  }
  .spacer {
    display: none;
  }
  .drawer-scrim {
    display: none;
  }

  @media (max-width: 760px) {
    .app {
      height: 100dvh;
    }
    .status {
      padding: calc(6px + env(safe-area-inset-top)) 10px 0;
      gap: 8px;
    }
    .menu-btn {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      margin-left: -4px;
      border-radius: 10px;
      color: var(--text-2);
    }
    .spacer {
      display: block;
      flex: 1;
    }
    .palette-btn kbd,
    .palette-label {
      display: none;
    }
    .palette-btn {
      width: 40px;
      height: 40px;
      justify-content: center;
      padding: 0;
      border: none;
    }
    .pill {
      max-width: 52vw;
    }
    .drawer-scrim {
      display: block;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.28);
      z-index: 14;
    }
    .content {
      /* Room for the add button so it never covers the last row. */
      padding: 4px 16px calc(96px + var(--kb, 0px));
    }
    .view-head {
      margin: 6px 0 12px;
      gap: 10px;
    }
    h1 {
      font-size: 24px;
    }
    .date {
      padding-bottom: 3px;
    }
    .notes {
      margin-left: 0;
    }
  }

  .loading {
    display: grid;
    place-items: center;
    height: 100vh;
    color: var(--text-3);
  }
</style>
