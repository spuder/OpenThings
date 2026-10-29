<script lang="ts">
  // Actions after a touch swipe on a to-do (swipe.svelte.ts): right offers Complete and Move,
  // left offers Move to Trash. A bottom sheet with buttons, not the palette, so no keyboard opens.
  import { fade, fly } from 'svelte/transition';
  import { store } from '../store.svelte';
  import { commands } from '../commands';

  const sheet = $derived(store.swipeSheet);
  const task = $derived(store.task(sheet?.id ?? null));
  let panel: HTMLDivElement | undefined = $state();

  // Focus the sheet, not a button, so Enter never deletes by accident; Tab reaches the buttons.
  $effect(() => {
    panel?.focus();
  });
  // The to-do went away meanwhile (synced from another device, say): don't leave a blank overlay.
  $effect(() => {
    if (!task) close();
  });

  function close() {
    store.overlay = null;
    store.swipeSheet = null;
  }

  /** Close, then act on the to-do. The id is read first: closing clears `sheet`, and `task` with it. */
  function run(fn: (id: string) => void) {
    const id = sheet!.id;
    close();
    fn(id);
  }

  /** Move… applies to the selection, so make it just this to-do first. */
  function move(id: string) {
    store.clearMulti();
    store.selectedId = id;
    commands.find((c) => c.id === 'task.move')?.run();
  }
</script>

{#if sheet && task}
  <div class="scrim" transition:fade={{ duration: 120 }} onclick={close} onkeydown={() => {}} role="presentation"></div>
  <div
    bind:this={panel}
    class="sheet"
    role="dialog"
    aria-modal="true"
    aria-label={task.title}
    tabindex="-1"
    transition:fly={{ y: 40, duration: 180 }}
    onkeydown={(e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    }}
  >
    <div class="title">{task.title}</div>
    {#if sheet.side === 'right'}
      <button class:complete={!task.completed_at} onclick={() => run((id) => store.toggleComplete(id))}>{task.completed_at ? 'Mark as not done' : 'Complete'}</button>
      <button class="move" onclick={() => run(move)}>Move to…</button>
    {:else}
      <button class="danger" onclick={() => run((id) => store.deleteTask(id))}>Move to Trash</button>
    {/if}
    <button class="cancel" onclick={close}>Cancel</button>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    /* Light, so the outlined to-do stays easy to see behind it. */
    background: rgba(0, 0, 0, 0.15);
  }
  .sheet {
    position: fixed;
    left: 50%;
    bottom: calc(12px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    width: min(420px, calc(100vw - 24px));
    z-index: 41;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    border-radius: 14px;
    background: var(--card);
    box-shadow: var(--card-shadow);
    outline: none;
  }
  .title {
    padding: 4px 8px 8px;
    font-size: 13px;
    color: var(--text-3);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button {
    min-height: 48px;
    border-radius: 10px;
    font-size: 16px;
    font-weight: 500;
    color: var(--text);
    background: var(--chip);
  }
  button.complete {
    color: #fff;
    background: var(--logbook);
  }
  button.move {
    color: #fff;
    background: var(--accent);
  }
  button.danger {
    color: #fff;
    background: var(--deadline);
  }
  button.cancel {
    margin-top: 4px;
    background: none;
    color: var(--text-2);
  }
</style>
