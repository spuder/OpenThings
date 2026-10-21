<script lang="ts">
  import { store } from '../store.svelte';
  import { commands, keyLabel } from '../commands';
  import Icon from './Icon.svelte';

  const task = $derived(store.task(store.selectedId));
  const canAct = $derived(store.isMulti ? store.actionIds.length > 0 : !!task && store.view.kind !== 'habits' && store.view.kind !== 'trash');

  function run(id: string) {
    commands.find((c) => c.id === id)?.run();
  }
  const key = (id: string) => {
    const k = commands.find((c) => c.id === id)?.keys[0];
    return k ? ` (${keyLabel(k)})` : '';
  };
</script>

<div class="bar" class:drawer={store.sidebarOpen || store.isMulti} role="toolbar" aria-label="To-do actions">
  <button class="fab" onclick={() => run('create.quickadd')} aria-label="New to-do">
    <Icon name="plus" size={26} />
  </button>
  <button class="add" onclick={() => run('create.quickadd')} title={`New to-do${key('create.quickadd')}`} aria-label="New to-do">
    <Icon name="plus" size={20} />
  </button>
  <button onclick={() => run('task.when')} disabled={!canAct} title={`When${key('task.when')}`} aria-label="When">
    <Icon name="calendar" size={20} />
  </button>
  <button onclick={() => run('task.move')} disabled={!canAct} title={`Move${key('task.move')}`} aria-label="Move">
    <Icon name="arrow" size={20} />
  </button>
  <button class="find" onclick={() => run('app.find')} title={`Quick Find${key('app.find')}`} aria-label="Quick Find">
    <Icon name="search" size={20} />
  </button>
</div>

<style>
  .bar {
    position: relative;
    z-index: 4;
    flex-shrink: 0;
    /* Sit closer to the home indicator than the full safe-area inset: the bar is short and the inset is ~34px. */
    padding: 2px 0 max(2px, calc(env(safe-area-inset-bottom) - 18px));
    display: flex;
    align-items: center;
    justify-content: center;
    gap: clamp(28px, 9vw, 120px);
    border-top: 1px solid var(--line);
    background: var(--bg);
  }
  button {
    width: 44px;
    height: 44px;
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
  .fab {
    display: none;
  }
  @media (max-width: 760px) {
    /* Phones: no toolbar. Floating round buttons above the home indicator: Find bottom left, add bottom right. */
    .bar {
      height: 0;
      padding: 0;
      border: none;
    }
    button:not(.fab, .find) {
      display: none;
    }
    .find {
      position: fixed;
      left: 18px;
      bottom: calc(21px + env(safe-area-inset-bottom));
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--card);
      box-shadow: var(--card-shadow);
    }
    .find:hover:not(:disabled) {
      background: var(--card);
    }
    .fab {
      display: grid;
      position: fixed;
      right: 18px;
      bottom: calc(14px + env(safe-area-inset-bottom));
      width: 58px;
      height: 58px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
      transition: transform 0.12s var(--ease);
    }
    .fab :global(svg) {
      stroke: #fff;
    }
    .fab:hover:not(:disabled) {
      background: var(--accent);
    }
    .fab:active {
      transform: scale(0.92);
    }
    /* Out of the way while the list drawer is open. */
    .find,
    .fab {
      transition: transform 0.16s var(--ease), opacity 0.16s;
    }
    .drawer .find,
    .drawer .fab {
      opacity: 0;
      transform: scale(0.8);
      pointer-events: none;
    }
  }
  button:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
