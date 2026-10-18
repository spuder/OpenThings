<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fade, slide } from 'svelte/transition';
  import { store, TRASH_DAYS } from '../store.svelte';
  import Icon from './Icon.svelte';

  function daysLeft(iso: string): number {
    const age = (store.now - Date.parse(iso)) / 86_400_000;
    return Math.max(0, Math.ceil(TRASH_DAYS - age));
  }
  function deletedAgo(iso: string): string {
    const d = Math.floor((store.now - Date.parse(iso)) / 86_400_000);
    return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
  }
</script>

<div class="trash">
  <div class="bar">
    <p>Deleted to-dos stay here for {TRASH_DAYS} days, then they're gone for good.</p>
    {#if store.trashed.length}
      <button class="empty-btn" onclick={() => confirm(`Permanently delete ${store.trashed.length} to-dos?`) && store.emptyTrash()}>Empty Trash</button>
    {/if}
  </div>

  {#if !store.trashed.length}
    <div class="empty" in:fade>
      <Icon name="trash" size={40} />
      <p>Trash is empty.</p>
    </div>
  {/if}

  {#each store.trashed as t (t.id)}
    <div
      class="item"
      class:selected={store.selectedId === t.id}
      animate:flip={{ duration: 200 }}
      out:slide={{ duration: 160 }}
      onclick={() => (store.selectedId = t.id)}
      onkeydown={() => {}}
      role="option"
      aria-selected={store.selectedId === t.id}
      tabindex="-1"
    >
      <div class="main">
        <span class="title">{t.title}</span>
        <span class="sub">
          {#if store.containerName(t)}{store.containerName(t)} · {/if}Deleted {deletedAgo(t.deleted_at!)} · purges in {daysLeft(t.deleted_at!)}d
        </span>
      </div>
      <div class="actions">
        <button onclick={(e) => { e.stopPropagation(); store.restoreTask(t.id); }} title="Restore (⇧R)">Restore</button>
        <button class="danger" onclick={(e) => { e.stopPropagation(); store.purgeTask(t.id); }} title="Delete permanently (⌫)">Delete</button>
      </div>
    </div>
  {/each}
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }
  .bar p {
    margin: 0;
    color: var(--text-3);
    font-size: 13px;
  }
  .empty-btn {
    font-size: 13px;
    color: var(--deadline);
    border: 1px solid var(--line-strong);
    border-radius: 8px;
    padding: 5px 11px;
    flex-shrink: 0;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    margin: 0 -10px;
    border-radius: var(--radius);
  }
  .item.selected {
    background: var(--select);
  }
  .main {
    flex: 1;
    min-width: 0;
    display: grid;
  }
  .title {
    font-size: 14.5px;
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: 12px;
    color: var(--text-3);
  }
  .actions {
    display: flex;
    gap: 4px;
  }
  .actions button {
    font-size: 12.5px;
    padding: 4px 10px;
    border-radius: 7px;
    color: var(--accent);
  }
  .actions button:hover {
    background: var(--chip);
  }
  .actions .danger {
    color: var(--deadline);
  }
  .empty {
    display: grid;
    place-items: center;
    gap: 8px;
    padding-top: 16vh;
    color: var(--text-3);
  }
  @media (max-width: 760px) {
    .bar {
      flex-direction: column;
      align-items: flex-start;
    }
    .actions button {
      padding: 8px 10px;
    }
  }
</style>
