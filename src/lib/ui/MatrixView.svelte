<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fade } from 'svelte/transition';
  import { store } from '../store.svelte';
  import TaskRow from './TaskRow.svelte';

  const tone: Record<string, string> = {
    do: 'var(--urgent)',
    schedule: 'var(--important)',
    delegate: 'var(--star)',
    drop: 'var(--text-3)',
  };
  const hint: Record<string, string> = {
    do: 'U + I',
    schedule: 'I',
    delegate: 'U',
    drop: '—',
  };
</script>

<div class="grid">
  {#each store.groups as g (g.key)}
    <section style:--tone={tone[g.key]}>
      <header>
        <h2>{g.title}</h2>
        <span class="sub">{g.subtitle}</span>
        <span class="count">{g.items.length}</span>
        <kbd title="Toggle with U and I">{hint[g.key]}</kbd>
      </header>
      <div class="items">
        {#each g.items as t (t.id)}
          <div animate:flip={{ duration: 260 }} in:fade={{ duration: 160 }}>
            <TaskRow task={t} showContainer showWhen />
          </div>
        {/each}
        {#if !g.items.length}<p class="empty">Empty</p>{/if}
      </div>
    </section>
  {/each}
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    padding-bottom: 30px;
  }
  section {
    border: 1px solid var(--line);
    border-top: 3px solid var(--tone);
    border-radius: 10px;
    padding: 10px 20px 12px;
    min-height: 220px;
    background: color-mix(in srgb, var(--tone) 3%, var(--bg));
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 6px;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--tone);
  }
  .sub {
    font-size: 12px;
    color: var(--text-3);
    flex: 1;
  }
  .count {
    font-size: 12px;
    color: var(--text-3);
  }
  .empty {
    color: var(--text-3);
    font-size: 13px;
  }
  @media (max-width: 900px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
