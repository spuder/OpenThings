<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fade } from 'svelte/transition';
  import { store } from '../store.svelte';
  import { addDays, parseYmd } from '../dates';
  import { challengeProgress, checksInWeek, describeSchedule, habitStreak, isScheduledDay, parseSchedule } from '../views';
  import { relLabel } from '../dates';
  import { prompt } from '../commands';
  import Icon from './Icon.svelte';
  import { isNarrow } from '../env';

  // A week on phones, three weeks on wider screens.
  const DAYS = isNarrow() ? 7 : 21;
  const days = $derived(Array.from({ length: DAYS }, (_, i) => addDays(store.day, i - DAYS + 1)));
  const letter = (d: string) => 'SMTWTFS'[parseYmd(d).getDay()];
</script>

<div class="habits" style:--days={DAYS}>
  <div class="head">
    <span class="name-col"></span>
    {#each days as d (d)}
      <span class="day-label" class:today={d === store.day}>{letter(d)}</span>
    {/each}
    <span class="streak-col">Streak</span>
  </div>

  {#each store.habits as h (h.id)}
    {@const done = store.habitDays(h.id)}
    {@const sched = parseSchedule(h.schedule)}
    {@const st = habitStreak(sched, done, store.day)}
    {@const s = st.value}
    {@const ch = h.target_days && h.start_date ? challengeProgress(h.start_date, h.target_days, done, store.day, sched) : null}
    {@const weekDone = sched.kind === 'times' ? checksInWeek(done, store.day) : 0}
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
      <span class="name-col">
        <span class="name">{h.name}</span>
        {#if sched.kind !== 'daily' || store.selectedId === h.id}
          <button
            class="sched"
            class:met={sched.kind === 'times' && weekDone >= sched.perWeek}
            onclick={(e) => {
              e.stopPropagation();
              store.selectedId = h.id;
              store.paletteMode = { kind: 'schedule' };
              store.overlay = 'palette';
            }}
            title="Change schedule (W)"
          >
            {describeSchedule(sched)}{#if sched.kind === 'times'}{` · ${weekDone}/${sched.perWeek} this week`}{/if}
          </button>
        {/if}
        {#if ch}
          <span class="challenge" class:finished={ch.finished}>
            {#if ch.finished}
              {ch.done >= ch.required ? 'Completed' : 'Ended'} · {ch.done}/{ch.required} check-ins
            {:else}
              Day {ch.day} of {ch.total} · {ch.done}{ch.required !== ch.total ? `/${ch.required}` : ''} done{#if ch.missed}{` · ${ch.missed} missed`}{/if} · ends {relLabel(ch.end, store.day)}
            {/if}
          </span>
          <span class="progress" aria-hidden="true"><span style:width={`${Math.min(1, ch.done / Math.max(1, ch.required)) * 100}%`}></span></span>
        {:else if store.selectedId === h.id}
          <button
            class="set-len"
            onclick={(e) => {
              e.stopPropagation();
              store.paletteMode = { kind: 'challenge' };
              store.overlay = 'palette';
            }}>Set a 30/60/75-day challenge <kbd>C</kbd></button
          >
        {/if}
      </span>
      {#each days as d (d)}
        <button
          class="cell"
          class:on={done.has(d)}
          class:today={d === store.day}
          class:outside={!!ch && (d < ch.start || d > ch.end)}
          class:off={!isScheduledDay(sched, d)}
          onclick={(e) => {
            e.stopPropagation();
            store.selectedId = h.id;
            store.toggleHabit(h.id, d);
          }}
          aria-label={`${h.name} on ${d}`}
          aria-pressed={done.has(d)}
        ></button>
      {/each}
      <span class="streak-col" class:hot={st.unit === 'week' ? s >= 2 : s >= 3} title={st.unit === 'week' ? `${s} week streak` : `${s} day streak`}>
        {#if s > 0}<Icon name="habits" size={14} />{/if}
        {s}{st.unit === 'week' ? 'w' : ''}
      </span>
    </div>
  {/each}

  <button class="add" onclick={() => prompt('New habit', (n) => store.addHabit(n), 'Name, plus options: Gym 5x · Journal weekdays · Cold shower 75d')}>
    <Icon name="plus" size={15} /> New habit <kbd>⇧H</kbd>
  </button>
</div>

<style>
  .habits {
    padding-top: 8px;
  }
  .head,
  .habit {
    display: grid;
    grid-template-columns: minmax(110px, 1fr) repeat(var(--days), 22px) 56px;
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
  .name-col {
    display: grid;
    gap: 2px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .challenge {
    font-size: 11.5px;
    color: var(--text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .challenge.finished {
    color: var(--logbook);
    font-weight: 600;
  }
  .progress {
    display: block;
    height: 3px;
    border-radius: 2px;
    background: var(--chip);
    overflow: hidden;
    max-width: 180px;
  }
  .progress span {
    display: block;
    height: 100%;
    background: var(--habits);
    border-radius: inherit;
    transition: width 0.4s var(--ease);
  }
  .set-len {
    font-size: 11.5px;
    color: var(--accent);
    text-align: left;
  }
  .set-len kbd {
    font-size: 10px;
    line-height: 14px;
  }
  .sched {
    font-size: 11.5px;
    color: var(--text-3);
    text-align: left;
    width: fit-content;
  }
  .sched:hover {
    color: var(--accent);
  }
  .sched.met {
    color: var(--logbook);
    font-weight: 600;
  }
  /* Not a due day: lighter, still checkable. */
  .cell.off:not(.on) {
    background: transparent;
    outline: 1px dashed var(--line-strong);
    outline-offset: -1px;
  }
  .cell.off.today:not(.on) {
    outline: 1.5px dashed var(--habits);
  }
  .cell.outside {
    opacity: 0.35;
  }
  .add {
    margin-top: 16px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
    font-size: 13px;
  }
  @media (max-width: 760px) {
    .head,
    .habit {
      grid-template-columns: repeat(var(--days), minmax(0, 1fr)) 48px;
      gap: 4px 3px;
    }
    .name-col {
      grid-column: 1 / -1;
      padding-right: 0;
    }
    .head .name-col {
      display: none;
    }
    .progress {
      max-width: none;
    }
    .cell {
      width: 100%;
      max-width: 40px;
      height: 30px;
      border-radius: 8px;
    }
    .habit {
      padding: 9px 8px;
      margin: 0 -8px;
    }
  }
</style>
