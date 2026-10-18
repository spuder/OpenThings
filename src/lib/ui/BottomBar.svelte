<script lang="ts">
  import { store } from '../store.svelte';
  import { commands, keyLabel } from '../commands';
  import Icon from './Icon.svelte';

  const task = $derived(store.task(store.selectedId));
  const canAct = $derived(!!task && store.view.kind !== 'habits' && store.view.kind !== 'trash');

  function run(id: string) {
    commands.find((c) => c.id === id)?.run();
  }
  const key = (id: string) => {
    const k = commands.find((c) => c.id === id)?.keys[0];
    return k ? ` (${keyLabel(k)})` : '';
  };
</script>

<div class="bar" role="toolbar" aria-label="To-do actions">
  <button onclick={() => run('create.quickadd')} title={`New to-do${key('create.quickadd')}`} aria-label="New to-do">
    <Icon name="plus" size={20} />
  </button>
  <button onclick={() => run('task.when')} disabled={!canAct} title={`When${key('task.when')}`} aria-label="When">
    <Icon name="calendar" size={20} />
  </button>
  <button onclick={() => run('task.move')} disabled={!canAct} title={`Move${key('task.move')}`} aria-label="Move">
    <Icon name="arrow" size={20} />
  </button>
  <button onclick={() => run('app.find')} title={`Quick Find${key('app.find')}`} aria-label="Quick Find">
    <Icon name="search" size={20} />
  </button>
</div>

<style>
  .bar {
    flex-shrink: 0;
    height: calc(52px + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: clamp(28px, 9vw, 120px);
    border-top: 1px solid var(--line);
    background: var(--bg);
  }
  button {
    width: 40px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    color: var(--text-2);
    transition:
      background 0.12s,
      opacity 0.12s;
  }
  button :global(svg) {
    stroke: var(--text-2);
  }
  button:hover:not(:disabled) {
    background: var(--chip);
  }
  button:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
