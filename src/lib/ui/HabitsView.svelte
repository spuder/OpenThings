<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fade } from 'svelte/transition';
  import { store } from '../store.svelte';
  import { addDays, parseYmd } from '../dates';
  import { streak } from '../views';
  import { prompt } from '../commands';
  import Icon from './Icon.svelte';

  const DAYS = 21;
  const days = $derived(Array.from({ length: DAYS }, (_, i) => addDays(store.day, i - DAYS + 1)));
  const letter = (d: string) => 'SMTWTFS'[parseYmd(d).getDay()];
</script>

<div class="habits">
  <div class="head">
    <span class="name-col"></span>
    {#each days as d (d)}
      <span class="day-label" class:today={d === store.day}>{letter(d)}</span>
    {/each}
    <span class="streak-col">Streak</span>
  </div>

  {#each store.habits as h (h.id)}
    {@const done = store.habitDays(h.id)}
    {@const s = streak(done, store.day)}
    <div
      class="habit"
      class:selected={store.selectedId === h.id}
      animate:flip={{ duration: 200 }}
      in:fade
      onclick={() => (store.selectedId = h.id)}
      onkeydown={() => {}}
      role="option"
      aria-selected={store.selectedId === h.id}
      tabindex="-1"
    >
      <span class="name-col">{h.name}</span>
      {#each days as d (d)}
        <button
          class="cell"
          class:on={done.has(d)}
          class:today={d === store.day}
          onclick={(e) => {
            e.stopPropagation();
            store.selectedId = h.id;
            store.toggleHabit(h.id, d);
          }}
          aria-label={`${h.name} on ${d}`}
          aria-pressed={done.has(d)}
        ></button>
      {/each}
      <span class="streak-col" class:hot={s >= 3}>
        {#if s > 0}<Icon name="habits" size={14} />{/if}
        {s}
      </span>
    </div>
  {/each}

  <button class="add" onclick={() => prompt('New habit', (n) => store.addHabit(n))}>
    <Icon name="plus" size={15} /> New habit <kbd>⇧N</kbd>
  </button>
</div>

<style>
  .habits {
    padding-top: 8px;
  }
  .head,
  .habit {
    display: grid;
    grid-template-columns: minmax(140px, 1fr) repeat(21, 22px) 64px;
    align-items: center;
    gap: 4px;
  }
  .head {
    color: var(--text-3);
    font-size: 11px;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .day-label {
    text-align: center;
  }
  .day-label.today {
    color: var(--habits);
  }
  .habit {
    padding: 7px 10px;
    margin: 0 -10px;
    border-radius: var(--radius);
    cursor: default;
  }
  .habit.selected {
    background: var(--select);
  }
  .name-col {
    font-size: 14.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-right: 8px;
  }
  .cell {
    width: 18px;
    height: 18px;
    margin: 0 auto;
    border-radius: 5px;
    background: var(--chip);
    transition:
      background 0.15s,
      transform 0.15s var(--ease);
  }
  .cell:hover {
    transform: scale(1.12);
  }
  .cell.today {
    outline: 1.5px solid var(--habits);
    outline-offset: 1px;
  }
  .cell.on {
    background: var(--habits);
    animation: pop 0.3s var(--ease);
  }
  @keyframes pop {
    40% {
      transform: scale(1.25);
    }
  }
  .streak-col {
    text-align: right;
    font-size: 13px;
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 3px;
  }
  .head .streak-col {
    font-size: 11px;
  }
  .streak-col.hot {
    color: var(--habits);
    font-weight: 600;
  }
  .add {
    margin-top: 16px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
    font-size: 13px;
  }
</style>
