<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fade, slide } from 'svelte/transition';
  import { store, type Group } from '../store.svelte';
  import TaskRow from './TaskRow.svelte';
  import Icon from './Icon.svelte';
  import { dropLine } from './drag.svelte';

  let { groups, showWhen = false, showContainer = false, empty = 'Nothing here.', hideEmpty = false }: {
    groups: Group[];
    showWhen?: boolean;
    showContainer?: boolean;
    empty?: string;
    /** No empty-state message: the view shows something else above the list (Someday's idle projects). */
    hideEmpty?: boolean;
  } = $props();

  const total = $derived(groups.reduce((n, g) => n + g.items.length, 0));

  /** In a multi-selection, a picked row whose neighbour is picked too joins it into one block. */
  const joined = (items: Group['items'], i: number, dir: -1 | 1) => store.isMulti && store.isPicked(items[i].id) && !!items[i + dir] && store.isPicked(items[i + dir].id);
</script>

{#if total === 0 && !hideEmpty && !groups.some((g) => g.title)}
  <div class="empty" in:fade={{ duration: 200 }}>
    <Icon name={store.view.kind === 'today' ? 'today' : 'logbook'} size={40} />
    <p>{empty}</p>
  </div>
{/if}

{#each groups as g (g.key)}
  <section class="group" class:titled={!!g.title} data-group={g.key}>
    {#if g.completedCount !== undefined}
      <div class="completed-bar">
        <button class="completed-toggle" class:open={store.showCompleted} onclick={() => store.toggleShowCompleted()} aria-expanded={store.showCompleted} title={`${store.showCompleted ? 'Hide' : 'Show'} completed (z c)`}>
          <span class="caret"><Icon name="caret" size={14} /></span>
          <span>{g.completedCount} completed</span>
        </button>
      </div>
    {:else if g.title}
      <header class:evening={g.key === 'evening'}>
        {#if g.key === 'evening'}<Icon name="evening" size={15} />{/if}
        <h2>{g.title}</h2>
        {#if g.subtitle}<span class="sub">{g.subtitle}</span>{/if}
        {#if g.headingId}
          <button class="remove" onclick={() => store.deleteHeading(g.headingId!)} aria-label={`Remove ${g.title} heading`} title="Remove heading">×</button>
        {/if}
      </header>
    {/if}
    <div class="items" class:drop-end={dropLine(g.key, null)} role="listbox" aria-multiselectable={store.isMulti} aria-label={g.title ?? store.viewTitle}>
      {#each g.items as t, i (t.id)}
        <div class="slot" class:drop-before={dropLine(g.key, t.id)} animate:flip={{ duration: 220 }} in:slide={{ duration: 180 }} out:slide={{ duration: 160 }}>
          <TaskRow task={t} {showWhen} showContainer={showContainer && g.key !== t.project_id} joinUp={joined(g.items, i, -1)} joinDown={joined(g.items, i, 1)} />
        </div>
      {/each}
    </div>
  </section>
{/each}

<style>
  .group {
    margin-bottom: 18px;
  }
  .group.titled {
    margin-top: 26px;
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding-bottom: 6px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--line);
  }
  header.evening {
    align-items: center;
    color: var(--evening);
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
  }
  .sub {
    font-size: 12.5px;
    color: var(--text-3);
  }
  .remove {
    align-self: center;
    margin-left: auto;
    width: 44px;
    height: 44px;
    /* A 44px touch target without making the header taller. */
    margin-block: -14px;
    font-size: 20px;
    line-height: 1;
    color: var(--text-3);
    opacity: 0.6;
  }
  .remove:hover,
  .remove:focus-visible {
    opacity: 1;
    color: var(--text);
  }
  /* A quiet, centered divider: hairlines either side of a small toggle. */
  .completed-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--text-3);
  }
  .completed-bar::before,
  .completed-bar::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line);
  }
  .completed-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 44px;
    padding: 0 10px;
    font-size: 12px;
    letter-spacing: 0.02em;
    color: inherit;
    opacity: 0.75;
    transition: opacity 0.15s;
  }
  .completed-toggle:hover,
  .completed-toggle:focus-visible {
    opacity: 1;
  }
  .caret {
    display: inline-flex;
    transition: transform 0.2s ease;
  }
  .completed-toggle.open .caret {
    transform: rotate(90deg);
  }
  .items {
    /* Something to drop on when a group (an empty heading) has no rows. */
    min-height: 8px;
  }
  .empty {
    display: grid;
    place-items: center;
    gap: 8px;
    padding-top: 18vh;
    color: var(--text-3);
    opacity: 0.8;
  }
  .empty p {
    margin: 0;
  }
</style>
