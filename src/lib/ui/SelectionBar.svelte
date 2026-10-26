<script lang="ts">
  import { fly } from 'svelte/transition';
  import { store } from '../store.svelte';
  import { commands, keyLabel } from '../commands';
  import Icon from './Icon.svelte';

  /** Shown while several to-dos are selected or selection mode is on: the count and the bulk actions. */
  const n = $derived(store.actionIds.length);
  const all = $derived(n > 0 && n === store.selectable.length);

  function run(id: string) {
    commands.find((c) => c.id === id)?.run();
  }
  const key = (id: string) => {
    const k = commands.find((c) => c.id === id)?.keys[0];
    return k ? ` (${keyLabel(k)})` : '';
  };
</script>

<div class="selbar" role="toolbar" aria-label="Selected to-dos" transition:fly={{ y: 12, duration: 160 }} data-no-swipe>
  <span class="count" aria-live="polite">{n ? `${n} selected` : 'Tap to-dos to select'}</span>
  {#if !all && store.selectable.length > 1}
    <button class="text" onclick={() => run('sel.all')} title={`Select all${key('sel.all')}`}>All</button>
  {/if}
  <span class="sep"></span>
  <button onclick={() => run('task.complete')} disabled={!n} title={`Complete${key('task.complete')}`} aria-label="Complete">
    <Icon name="logbook" size={20} />
  </button>
  <button onclick={() => run('task.when')} disabled={!n} title={`When${key('task.when')}`} aria-label="When">
    <Icon name="calendar" size={20} />
  </button>
  <button onclick={() => run('task.move')} disabled={!n} title={`Move${key('task.move')}`} aria-label="Move">
    <Icon name="arrow" size={20} />
  </button>
  <button onclick={() => run('task.delete')} disabled={!n} title={`Move to Trash${key('task.delete')}`} aria-label="Move to Trash">
    <Icon name="trash" size={20} />
  </button>
  <button class="text done" onclick={() => run('sel.escape')} title="Done (Esc)">Done</button>
</div>

<style>
  .selbar {
    position: absolute;
    left: 50%;
    bottom: 62px;
    transform: translateX(-50%);
    z-index: 6;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 6px 4px 14px;
    background: var(--card);
    border-radius: 12px;
    box-shadow: var(--card-shadow), 0 0 0 1px var(--line);
    white-space: nowrap;
  }
  .count {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    font-variant-numeric: tabular-nums;
    margin-right: 6px;
  }
  .sep {
    width: 1px;
    height: 22px;
    background: var(--line);
    margin: 0 4px;
  }
  button {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    color: var(--text-2);
    transition: background 0.12s, opacity 0.12s;
  }
  button.text {
    width: auto;
    padding: 0 10px;
    font-size: 13.5px;
    font-weight: 600;
  }
  .done {
    color: var(--accent);
  }
  button:hover:not(:disabled) {
    background: var(--chip);
  }
  button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  @media (max-width: 760px) {
    /* Phones: across the bottom, where the add and Find buttons usually float. */
    .selbar {
      position: fixed;
      left: 10px;
      right: 10px;
      bottom: calc(10px + env(safe-area-inset-bottom));
      transform: none;
      padding-left: 12px;
    }
    .count {
      flex: 1;
      font-size: 14.5px;
    }
    .sep {
      display: none;
    }
  }
</style>
