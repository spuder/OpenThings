<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { store } from './lib/store.svelte';
  import { handleKey } from './lib/commands';
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

  store.init().then(() => store.go({ kind: 'today' }));

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

<svelte:window onkeydown={handleKey} />

{#if store.ready}
  <div class="app">
    <Sidebar />
    <main>
      <div class="status">
        {#if store.pomodoro}
          <button class="pill pomo" onclick={() => store.cancelPomodoro()} title="Cancel Pomodoro (⇧P)" transition:fade>
            ◷ {formatDuration(store.pomodoro.endsAt - store.now)}
          </button>
        {/if}
        {#if store.tracking && trackedTask}
          <button class="pill live" onclick={() => store.stopTracking()} title="Stop timer (⇧X)" transition:fade>
            <span class="dot"></span>{trackedTask.title} · {formatDuration(store.now - store.tracking.start)}
          </button>
        {/if}
        <span class="sync" title="Local-first: all changes are written to SQLite and an op log; no server configured yet.">
          Local · {store.opCount} ops
        </span>
        <button class="palette-btn" onclick={() => { store.paletteMode = { kind: 'commands' }; store.overlay = 'palette'; }}>
          <Icon name="search" size={14} /> Commands <kbd>{navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl K'}</kbd>
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
            </header>
            {#if project?.notes}<p class="notes">{project.notes}</p>{/if}

            <div in:fade={{ duration: 160 }}>
              {#if v.kind === 'dump'}
                <DumpView />
              {:else if v.kind === 'habits'}
                <HabitsView />
              {:else if v.kind === 'matrix'}
                <MatrixView />
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

      <button class="fab" onclick={() => { store.quickAddPrefill = ''; store.overlay = 'quickadd'; }} title="Quick add (Q)" aria-label="Quick add">
        <Icon name="plus" size={20} />
      </button>
    </main>
  </div>

  {#if store.overlay === 'quickadd'}<QuickAdd />{/if}
  {#if store.overlay === 'palette'}<Palette />{/if}
  {#if store.overlay === 'help'}<Help />{/if}

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
  .sync {
    font-size: 11.5px;
    color: var(--text-3);
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
    padding: 18px 56px 120px;
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
  .notes {
    color: var(--text-2);
    margin: -8px 0 16px 40px;
    font-size: 13.5px;
  }
  .fab {
    position: absolute;
    right: 28px;
    bottom: 26px;
    width: 42px;
    height: 42px;
    border-radius: 50%;
    background: var(--accent);
    color: white;
    display: grid;
    place-items: center;
    box-shadow: 0 4px 14px rgba(47, 111, 237, 0.35);
    transition: transform 0.15s var(--ease);
  }
  .fab :global(svg) {
    stroke: white;
  }
  .fab:hover {
    transform: scale(1.06);
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
  .loading {
    display: grid;
    place-items: center;
    height: 100vh;
    color: var(--text-3);
  }
</style>
