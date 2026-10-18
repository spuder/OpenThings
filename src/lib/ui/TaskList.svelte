<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fade, slide } from 'svelte/transition';
  import { store, type Group } from '../store.svelte';
  import TaskRow from './TaskRow.svelte';
  import Icon from './Icon.svelte';

  let { groups, showWhen = false, showContainer = false, empty = 'Nothing here.' }: {
    groups: Group[];
    showWhen?: boolean;
    showContainer?: boolean;
    empty?: string;
  } = $props();

  const total = $derived(groups.reduce((n, g) => n + g.items.length, 0));
</script>

{#if total === 0 && !groups.some((g) => g.title)}
  <div class="empty" in:fade={{ duration: 200 }}>
    <Icon name={store.view.kind === 'today' ? 'today' : 'logbook'} size={40} />
    <p>{empty}</p>
  </div>
{/if}

{#each groups as g (g.key)}
  <section class="group" class:titled={!!g.title}>
    {#if g.title}
      <header class:evening={g.key === 'evening'}>
        {#if g.key === 'evening'}<Icon name="evening" size={15} />{/if}
        <h2>{g.title}</h2>
        {#if g.subtitle}<span class="sub">{g.subtitle}</span>{/if}
      </header>
    {/if}
    <div class="items" role="listbox" aria-label={g.title ?? store.viewTitle}>
      {#each g.items as t (t.id)}
        <div animate:flip={{ duration: 220 }} in:slide={{ duration: 180 }} out:slide={{ duration: 160 }}>
          <TaskRow task={t} {showWhen} showContainer={showContainer && g.key !== t.project_id} />
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
