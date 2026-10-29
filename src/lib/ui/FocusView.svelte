<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import { store } from '../store.svelte';
  import { formatDuration } from '../dates';
  import Checkbox from './Checkbox.svelte';
  import Icon from './Icon.svelte';

  const f = $derived(store.focus);
  const task = $derived(store.task(f?.taskId ?? null));
  const items = $derived(task ? store.checklistFor(task.id) : []);
  const remaining = $derived(store.focusRemaining());
  const total = $derived((f?.minutes ?? 25) * 60_000);
  const progress = $derived(total ? 1 - remaining / total : 0);
  const running = $derived(!!f?.endsAt);
  const container = $derived(task ? store.containerName(task) : null);

  const R = 120;
  const C = 2 * Math.PI * R;
  const presets = [15, 25, 50];

  function complete() {
    if (!task) return;
    store.toggleComplete(task.id);
    store.endFocus();
  }

  function onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'escape' || k === 'f') store.closeFocus();
    else if (k === ' ' || k === 'enter') store.focusToggle();
    else if (k === 'r') store.focusReset();
    else if (k === 's') store.focusSkip();
    else if (k === 'c') complete();
    else if (k === '1' || k === '2' || k === '3') store.focusSetMinutes(presets[Number(k) - 1]);
    else return;
    e.preventDefault();
  }

  // Show the countdown in the browser tab while focusing.
  $effect(() => {
    const prev = document.title;
    return () => (document.title = prev);
  });
  $effect(() => {
    if (f) document.title = `${formatDuration(remaining)} · ${f.phase === 'work' ? task?.title ?? 'Focus' : 'Break'}`;
  });
</script>

<svelte:window onkeydown={onKey} />

{#if f && task}
  <div class="focus" class:break={f.phase === 'break'} transition:fade={{ duration: 200 }} role="dialog" aria-modal="true" aria-label="Focus mode">
    <button class="close" onclick={() => store.closeFocus()} aria-label="Close focus mode (Esc)">
      <span>Esc</span>
    </button>

    <div class="inner" in:scale={{ start: 0.97, duration: 260 }}>
      <div class="label">
        {#if f.phase === 'work'}Focus{#if container}{` · ${container}`}{/if}{:else}Break{/if}
      </div>
      <h1>{f.phase === 'work' ? task.title : 'Step away for a moment'}</h1>

      <div class="ring" role="timer" aria-live="off" aria-label={`${formatDuration(remaining)} remaining`}>
        <svg viewBox="0 0 280 280" aria-hidden="true">
          <circle cx="140" cy="140" r={R} class="track" />
          <circle cx="140" cy="140" r={R} class="bar" style:stroke-dasharray={C} style:stroke-dashoffset={C * (1 - progress)} />
        </svg>
        <div class="time">
          <span class="digits">{formatDuration(remaining)}</span>
          <span class="state">{running ? (f.phase === 'work' ? 'focusing' : 'on break') : remaining === total ? 'ready' : 'paused'}</span>
        </div>
      </div>

      <div class="controls">
        <button class="ctl" onclick={() => store.focusReset()} title="Reset (R)">Reset</button>
        <button class="play" onclick={() => store.focusToggle()} title="Start / pause (Space)">{running ? 'Pause' : remaining === total ? 'Start' : 'Resume'}</button>
        <button class="ctl" onclick={() => store.focusSkip()} title="Skip to {f.phase === 'work' ? 'break' : 'work'} (S)">Skip</button>
      </div>

      <div class="presets" role="radiogroup" aria-label="Session length">
        {#each presets as m, i}
          <button role="radio" aria-checked={f.minutes === m} class:on={f.minutes === m} onclick={() => store.focusSetMinutes(m)} title={`${m} minutes (${i + 1})`}>{m}m</button>
        {/each}
      </div>

      <div class="sessions" aria-label={`${f.sessions} sessions done`}>
        {#each Array(4) as _, i}
          <span class="pip" class:done={i < f.sessions % 4 || (f.sessions > 0 && f.sessions % 4 === 0)}></span>
        {/each}
        <span class="count">{f.sessions} {f.sessions === 1 ? 'session' : 'sessions'} · {formatDuration(store.trackedMs(task.id))} tracked</span>
      </div>

      {#if f.phase === 'work' && (items.length || task.notes)}
        <div class="detail" in:fade>
          {#if task.notes}<p class="notes">{task.notes}</p>{/if}
          {#if items.length}
            <ul>
              {#each items as c (c.id)}
                <li>
                  <Checkbox small checked={!!c.done} onToggle={() => store.toggleChecklist(c.id)} />
                  <span class:checked={c.done}>{c.title}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      <button class="complete" onclick={complete} title="Complete this to-do (X)">
        <Icon name="logbook" size={16} /> Complete to-do
      </button>

      <p class="keys"><kbd>Space</kbd> start/pause <kbd>R</kbd> reset <kbd>S</kbd> skip <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> length <kbd>C</kbd> complete <kbd>Esc</kbd> close</p>
    </div>
  </div>
{/if}

<style>
  .focus {
    --tone: var(--deadline);
    position: fixed;
    inset: 0;
    z-index: 25;
    background:
      radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--tone) 9%, transparent), transparent 60%),
      var(--bg);
    display: grid;
    place-items: center;
    overflow-y: auto;
    padding: calc(24px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom));
  }
  .focus.break {
    --tone: var(--logbook);
  }
  .close {
    position: absolute;
    top: calc(16px + env(safe-area-inset-top));
    right: 18px;
    font-size: 12px;
    color: var(--text-3);
    border: 1px solid var(--line-strong);
    border-radius: 8px;
    padding: 4px 10px;
  }
  .close:hover {
    color: var(--text);
  }
  .inner {
    width: min(520px, 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .label {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--tone);
  }
  h1 {
    font-size: clamp(22px, 4vw, 30px);
    font-weight: 700;
    margin: 8px 0 22px;
    line-height: 1.2;
  }
  .ring {
    position: relative;
    width: min(280px, 70vw);
    aspect-ratio: 1;
  }
  .ring svg {
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
  }
  circle {
    fill: none;
    stroke-width: 10;
  }
  .track {
    stroke: var(--chip);
  }
  .bar {
    stroke: var(--tone);
    stroke-linecap: round;
    transition: stroke-dashoffset 1s linear;
  }
  .time {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    gap: 2px;
  }
  .digits {
    font-size: clamp(44px, 12vw, 60px);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }
  .state {
    font-size: 12.5px;
    color: var(--text-3);
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-top: 22px;
  }
  .play {
    min-width: 128px;
    padding: 12px 22px;
    border-radius: 26px;
    background: var(--tone);
    color: white;
    font-weight: 600;
    font-size: 15px;
    transition: transform 0.15s var(--ease), filter 0.15s;
  }
  .play:hover {
    filter: brightness(1.06);
  }
  .play:active {
    transform: scale(0.97);
  }
  .ctl {
    padding: 10px 14px;
    border-radius: 20px;
    color: var(--text-2);
    font-size: 14px;
  }
  .ctl:hover {
    background: var(--chip);
  }
  .presets {
    display: inline-flex;
    gap: 2px;
    background: var(--chip);
    border-radius: 9px;
    padding: 3px;
    margin-top: 16px;
  }
  .presets button {
    font-size: 12.5px;
    padding: 4px 12px;
    border-radius: 7px;
    color: var(--text-2);
  }
  .presets button.on {
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }
  .sessions {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 16px;
  }
  .pip {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 1.5px solid var(--tone);
  }
  .pip.done {
    background: var(--tone);
  }
  .count {
    font-size: 12px;
    color: var(--text-3);
    margin-left: 6px;
  }
  .detail {
    width: 100%;
    margin-top: 22px;
    text-align: left;
    border-top: 1px solid var(--line);
    padding-top: 14px;
  }
  .notes {
    color: var(--text-2);
    font-size: 14px;
    margin: 0 0 10px;
    white-space: pre-wrap;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    font-size: 14px;
  }
  li .checked {
    color: var(--text-3);
    text-decoration: line-through;
  }
  .complete {
    margin-top: 22px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--logbook);
    font-weight: 600;
    font-size: 14px;
    padding: 8px 14px;
    border-radius: 18px;
  }
  .complete:hover {
    background: color-mix(in srgb, var(--logbook) 10%, transparent);
  }
  .keys {
    margin-top: 18px;
    font-size: 11.5px;
    color: var(--text-3);
    line-height: 2;
  }
  .keys kbd {
    margin: 0 2px 0 8px;
  }
  @media (hover: none) and (pointer: coarse) {
    .keys {
      display: none;
    }
  }
</style>
