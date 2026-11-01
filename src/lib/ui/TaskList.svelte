<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fade, slide } from 'svelte/transition';
  import { store, type Group } from '../store.svelte';
  import TaskRow from './TaskRow.svelte';
  import Icon from './Icon.svelte';
  import { dropLine } from './drag.svelte';
  import { beforeAt, sortable, sortDrag, sortLine, viewAt, type SortSlot } from './sortDrag.svelte';
  import { headingMove, reorderSort } from '../dragRules';

  /**
   * Heading drag (gap 2): over another heading of this project, where it would land; over a
   * project in the sidebar, that project (the heading and its to-dos move there).
   */
  function headingSlot(id: string, x: number, y: number): SortSlot | null {
    const h = store.headings.find((x) => x.id === id);
    if (!h) return null;
    const v = viewAt(x, y);
    if (v) return v.kind === 'project' && headingMove(h, store.headings, store.projects, v.id) ? { kind: 'view', view: v } : null;
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('section[data-heading]');
    if (!el) return null;
    const rows = [...document.querySelectorAll<HTMLElement>('section[data-heading]')];
    const before = beforeAt(rows, el, y, 'data-heading');
    const list = store.headings.filter((x) => x.project_id === h.project_id);
    return reorderSort(list, id, before) === null ? null : { kind: 'before', before };
  }
  function headingDrop(id: string, s: SortSlot) {
    if (s.kind === 'view' && s.view.kind === 'project') store.moveHeadingToProject(id, s.view.id);
    else if (s.kind === 'before') store.reorderHeading(id, s.before);
  }

  let { groups, showWhen = false, showContainer = false, empty = 'Nothing here.' }: {
    groups: Group[];
    showWhen?: boolean;
    showContainer?: boolean;
    empty?: string;
  } = $props();

  const headed = $derived(groups.filter((g) => g.headingId));
  const total = $derived(groups.reduce((n, g) => n + g.items.length, 0));

  /** In a multi-selection, a picked row whose neighbour is picked too joins it into one block. */
  const joined = (items: Group['items'], i: number, dir: -1 | 1) => store.isMulti && store.isPicked(items[i].id) && !!items[i + dir] && store.isPicked(items[i + dir].id);
</script>

{#if total === 0 && !groups.some((g) => g.title)}
  <div class="empty" in:fade={{ duration: 200 }}>
    <Icon name={store.view.kind === 'today' ? 'today' : 'logbook'} size={40} />
    <p>{empty}</p>
  </div>
{/if}

{#each groups as g (g.key)}
  <section class="group" class:titled={!!g.title} data-group={g.key} data-heading={g.headingId} class:drop-before={!!g.headingId && sortLine('heading', g.headingId)} class:drop-end={!!g.headingId && sortLine('heading', null) && g === headed[headed.length - 1]} class:heading-dragged={!!g.headingId && sortDrag.kind === 'heading' && sortDrag.id === g.headingId}>
    {#if g.title && g.headingId}
      <header class="draggable-heading" title="Drag to reorder, or onto a project in the sidebar to move it there" {@attach sortable({ kind: 'heading', id: g.headingId, label: () => g.title ?? 'Heading', slotAt: (x, y) => headingSlot(g.headingId!, x, y), drop: (s) => headingDrop(g.headingId!, s), skip: 'button' })}>
        <h2>{g.title}</h2>
        {#if g.subtitle}<span class="sub">{g.subtitle}</span>{/if}
        <button class="remove" onclick={() => store.deleteHeading(g.headingId!)} aria-label={`Remove ${g.title} heading`} title="Remove heading">×</button>
      </header>
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
    position: relative;
    margin-bottom: 18px;
  }
  .group.titled {
    margin-top: 26px;
  }
  .heading-dragged {
    opacity: 0.45;
  }
  .draggable-heading {
    cursor: grab;
    touch-action: pan-y;
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
