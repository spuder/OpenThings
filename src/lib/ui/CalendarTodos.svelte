<script lang="ts">
  /**
   * The Time Blocking calendar's To-dos panel (#99): open to-dos to drag onto the calendar. Today,
   * the rest of This Week, then Anytime; typing searches every open to-do. Enter (or a click) on a
   * row blocks the next free slot for it instead, so it works from the keyboard too.
   */
  import { store } from '../store.svelte';
  import * as V from '../views';
  import * as TB from '../timeblocks';
  import type { Task } from '../types';
  import { calendarDraggable } from './calendarDrop.svelte';

  let q = $state('');
  const none = new Set<string>();

  const groups = $derived.by(() => {
    const ts = store.tasks.filter((t) => !t.dump);
    const query = q.trim().toLowerCase();
    if (query) return [{ title: 'Matches', items: ts.filter((t) => !t.completed_at && t.title.toLowerCase().includes(query)).slice(0, 60) }];
    const seen = new Set<string>();
    const fresh = (list: Task[]) => list.filter((t) => !seen.has(t.id) && !!seen.add(t.id));
    const today = V.todayView(ts, store.day, none);
    return [
      { title: 'Today', items: fresh([...today.day, ...today.evening]) },
      { title: 'This Week', items: fresh(V.thisWeek(ts, store.day, none).flatMap((g) => g.tasks)) },
      { title: 'Anytime', items: fresh(V.anytime(ts, store.day, none)).slice(0, 40) },
    ].filter((g) => g.items.length);
  });

  function areaOf(t: Task) {
    return t.area_id ?? store.projects.find((p) => p.id === t.project_id)?.area_id ?? null;
  }
  function where(t: Task) {
    return store.projects.find((p) => p.id === t.project_id)?.name ?? store.areas.find((a) => a.id === t.area_id)?.name ?? '';
  }
</script>

<aside class="todos" aria-label="To-dos to plan">
  <input bind:value={q} placeholder="Find a to-do…" aria-label="Find a to-do" autocomplete="off" spellcheck="false" />
  <div class="list">
    {#each groups as g (g.title)}
      <h4>{g.title}</h4>
      <ul>
        {#each g.items as t (t.id)}
          <li>
            <button
              class="todo"
              style:--c={TB.blockColor(areaOf(t), store.areas)}
              onclick={() => store.blockTimeFor({ kind: 'task', id: t.id })}
              title="Drag onto the calendar, or press Enter to block the next free slot"
              {@attach calendarDraggable({ kind: 'task', id: t.id })}
            >
              <span class="dot"></span>
              <span class="text">
                <span class="t">{t.title}</span>
                {#if where(t)}<small>{where(t)}</small>{/if}
              </span>
              {#if t.estimate_min}<em>{t.estimate_min}m</em>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="empty">{q.trim() ? 'No open to-dos match.' : 'Nothing open this week.'}</p>
    {/each}
  </div>
  <p class="tip">Drag a to-do from this list, or an area or project from the sidebar, onto the calendar.</p>
</aside>

<style>
  .todos {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 8px;
  }
  input {
    font: inherit;
    font-size: 13px;
    padding: 6px 8px;
    border: 1px solid var(--line-strong);
    border-radius: 7px;
    background: var(--bg);
    color: var(--text);
    outline: none;
  }
  input:focus {
    border-color: var(--accent);
  }
  .list {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  h4 {
    margin: 8px 4px 4px;
    font-size: 11.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-3);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .todo {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 5px 6px;
    border-radius: 6px;
    color: var(--text);
    cursor: grab;
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .todo:hover,
  .todo:focus-visible {
    background: var(--chip);
  }
  .dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c);
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .t,
  small {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .t {
    font-size: 13px;
  }
  small {
    font-size: 11px;
    color: var(--text-3);
  }
  em {
    font-style: normal;
    font-size: 11px;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .empty,
  .tip {
    margin: 6px 4px;
    font-size: 12px;
    color: var(--text-3);
  }
  @media (pointer: coarse) {
    .todo {
      min-height: 44px;
    }
    input {
      font-size: 16px;
    }
  }
</style>
