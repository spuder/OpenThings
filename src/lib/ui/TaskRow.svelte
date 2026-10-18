<script lang="ts">
  import { slide } from 'svelte/transition';
  import { store } from '../store.svelte';
  import type { Task } from '../types';
  import { daysBetween, formatDuration, relLabel } from '../dates';
  import { describeRule } from '../parse';
  import { commands, keyLabel } from '../commands';
  import Icon from './Icon.svelte';
  import Checkbox from './Checkbox.svelte';

  let { task, showWhen = false, showContainer = false }: { task: Task; showWhen?: boolean; showContainer?: boolean } = $props();

  const selected = $derived(store.selectedId === task.id);
  const expanded = $derived(store.expandedId === task.id);
  const done = $derived(task.completed_at !== null);
  const tags = $derived(store.tagsFor(task.id));
  const items = $derived(store.checklistFor(task.id));
  const container = $derived(showContainer ? store.containerName(task) : null);
  const tracking = $derived(store.tracking?.taskId === task.id);
  const tracked = $derived(store.trackedMs(task.id));
  const deadlineDiff = $derived(task.deadline ? daysBetween(store.day, task.deadline) : null);

  let el: HTMLElement | undefined = $state();
  let titleInput: HTMLInputElement | undefined = $state();
  let newItem = $state('');

  $effect(() => {
    if (selected && el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  $effect(() => {
    if (expanded && titleInput) titleInput.focus({ preventScroll: true });
  });

  function select() {
    store.selectedId = task.id;
  }
  function toggleOpen() {
    store.selectedId = task.id;
    store.expandedId = expanded ? null : task.id;
  }
  function saveTitle(e: Event) {
    const v = (e.target as HTMLInputElement).value.trim();
    if (v && v !== task.title) store.update(task.id, { title: v });
  }
  function saveNotes(e: Event) {
    const v = (e.target as HTMLTextAreaElement).value;
    if (v !== task.notes) store.update(task.id, { notes: v });
  }
  function fieldKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      (e.target as HTMLElement).blur();
      store.expandedId = null;
      e.stopPropagation();
    }
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') (e.target as HTMLElement).blur();
  }
  function addItem(e: KeyboardEvent) {
    if (e.key === 'Enter' && newItem.trim()) {
      store.addChecklist(task.id, newItem);
      newItem = '';
    } else if (e.key === 'Escape') {
      (e.target as HTMLElement).blur();
      e.stopPropagation();
    }
  }
  function run(id: string) {
    store.selectedId = task.id;
    commands.find((c) => c.id === id)?.run();
  }
  const key = (id: string) => keyLabel(commands.find((c) => c.id === id)?.keys[0] ?? '');
</script>

<div
  class="task"
  class:selected
  class:expanded
  class:done
  bind:this={el}
  data-id={task.id}
  role="option"
  aria-selected={selected}
  tabindex="-1"
  onclick={select}
  ondblclick={toggleOpen}
  onkeydown={() => {}}
>
  <div class="row">
    <Checkbox checked={done} onToggle={() => store.toggleComplete(task.id)} urgent={!!task.urgent && !!task.important} />
    <div class="main">
      {#if expanded}
        <input class="title-input" bind:this={titleInput} value={task.title} onblur={saveTitle} onkeydown={fieldKey} aria-label="Title" />
      {:else}
        <div class="title-line">
          {#if showWhen && task.when_date && !task.someday}
            {#if task.evening && task.when_date <= store.day}
              <span class="when evening"><Icon name="evening" size={13} /></span>
            {:else if task.when_date <= store.day}
              <span class="when today"><Icon name="today" size={13} /></span>
            {:else}
              <span class="when date">{relLabel(task.when_date, store.day)}</span>
            {/if}
          {/if}
          <span class="title">{task.title}</span>
          {#if task.notes}<span class="mini" title="Has notes"><Icon name="note" size={13} /></span>{/if}
          {#if items.length}<span class="mini count">{items.filter((i) => i.done).length}/{items.length}</span>{/if}
        </div>
        {#if container}<div class="container">{container}</div>{/if}
      {/if}
    </div>
    {#if !expanded}
      <div class="meta">
        {#each tags as t (t.id)}<span class="tag">{t.name}</span>{/each}
        {#if task.urgent}<span class="dot urgent" title="Urgent"></span>{/if}
        {#if task.important}<span class="dot important" title="Important"></span>{/if}
        {#if task.rrule}<span class="mini" title={describeRule(task.rrule)}><Icon name="repeat" size={13} /></span>{/if}
        {#if tracking}
          <span class="timer live"><span class="pulse"></span>{formatDuration(tracked)}</span>
        {:else if tracked > 0}
          <span class="timer">{formatDuration(tracked)}</span>
        {:else if task.estimate_min}
          <span class="estimate">{task.estimate_min}m</span>
        {/if}
        {#if task.deadline}
          <span class="deadline" class:overdue={deadlineDiff !== null && deadlineDiff <= 0}>
            <Icon name="flag" size={12} />
            {deadlineDiff === 0 ? 'today' : deadlineDiff !== null && deadlineDiff < 0 ? `${-deadlineDiff}d ago` : relLabel(task.deadline, store.day)}
          </span>
        {/if}
      </div>
    {/if}
  </div>

  {#if expanded}
    <div class="detail" transition:slide={{ duration: 160 }}>
      <textarea class="notes" placeholder="Notes" value={task.notes} onblur={saveNotes} onkeydown={fieldKey} rows="3"></textarea>

      <ul class="checklist">
        {#each items as c (c.id)}
          <li>
            <Checkbox small checked={!!c.done} onToggle={() => store.toggleChecklist(c.id)} />
            <span class:checked={c.done}>{c.title}</span>
            <button class="x" onclick={() => store.removeChecklist(c.id)} aria-label="Remove item">×</button>
          </li>
        {/each}
        <li class="add">
          <Icon name="checklist" size={14} />
          <input placeholder="Add checklist item" bind:value={newItem} onkeydown={addItem} />
        </li>
      </ul>

      <div class="bar">
        <div class="chips">
          {#if task.when_date || task.someday}
            <span class="chip">
              {#if task.someday}Someday{:else if task.evening}<Icon name="evening" size={12} /> This Evening{:else if task.when_date && task.when_date <= store.day}<Icon name="today" size={12} /> Today{:else if task.when_date}{relLabel(task.when_date, store.day)}{/if}
            </span>
          {/if}
          {#if task.deadline}<span class="chip deadline-chip"><Icon name="flag" size={12} /> {relLabel(task.deadline, store.day)}</span>{/if}
          {#if task.rrule}<span class="chip"><Icon name="repeat" size={12} /> {describeRule(task.rrule)}</span>{/if}
          {#each tags as t (t.id)}
            <span class="chip">#{t.name}<button class="x" onclick={() => store.removeTag(task.id, t.id)} aria-label="Remove tag">×</button></span>
          {/each}
          {#if tracked > 0 || tracking}<span class="chip"><Icon name="clock" size={12} /> {formatDuration(tracked)}</span>{/if}
        </div>
        <div class="actions">
          <button onclick={() => run('task.when')} title="When ({key('task.when')})"><Icon name="today" size={15} /></button>
          <button onclick={() => run('task.deadline')} title="Deadline ({key('task.deadline')})"><Icon name="flag" size={15} /></button>
          <button onclick={() => run('task.tag')} title="Tag ({key('task.tag')})">#</button>
          <button onclick={() => run('task.move')} title="Move ({key('task.move')})">→</button>
          <button class:on={task.urgent} onclick={() => store.toggleUrgent(task.id)} title="Urgent ({key('task.urgent')})">U</button>
          <button class:on={task.important} onclick={() => store.toggleImportant(task.id)} title="Important ({key('task.important')})">I</button>
          <button class:on={tracking} onclick={() => store.toggleTracking(task.id)} title="Timer ({key('time.track')})"><Icon name="clock" size={15} /></button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .task {
    border-radius: var(--radius);
    margin: 0 -10px;
    padding: 0 10px;
    outline: none;
    transition:
      background 0.12s,
      box-shadow 0.2s var(--ease),
      margin 0.2s var(--ease);
    cursor: default;
    user-select: none;
  }
  .task.selected:not(.expanded) {
    background: var(--select);
  }
  .task.expanded {
    background: var(--card);
    box-shadow: var(--card-shadow);
    margin: 10px -14px 14px;
    padding: 6px 14px 12px;
    user-select: text;
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 6px 0;
    min-height: 34px;
  }
  .main {
    flex: 1;
    min-width: 0;
    padding-top: 1px;
  }
  .title-line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14.5px;
  }
  .done .title {
    color: var(--text-3);
  }
  .container {
    font-size: 12px;
    color: var(--text-3);
    margin-top: 1px;
  }
  .when {
    display: inline-flex;
    flex-shrink: 0;
  }
  .when.date {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--text-2);
    background: var(--chip);
    border-radius: 5px;
    padding: 0 6px;
    line-height: 18px;
  }
  .mini {
    color: var(--text-3);
    display: inline-flex;
    flex-shrink: 0;
  }
  .mini.count {
    font-size: 11.5px;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    padding-top: 2px;
  }
  .tag {
    font-size: 11.5px;
    color: var(--text-2);
    border: 1px solid var(--line-strong);
    border-radius: 9px;
    padding: 0 7px;
    line-height: 17px;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }
  .dot.urgent {
    background: var(--urgent);
  }
  .dot.important {
    background: var(--important);
  }
  .estimate,
  .timer {
    font-size: 11.5px;
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .timer.live {
    color: var(--logbook);
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .pulse {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--logbook);
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
  .deadline {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 12px;
    color: var(--text-2);
  }
  .deadline.overdue {
    color: var(--deadline);
    font-weight: 600;
  }
  .title-input {
    width: 100%;
    border: none;
    outline: none;
    background: transparent;
    font-size: 15px;
    font-weight: 500;
    padding: 0;
  }
  .detail {
    padding-left: 30px;
  }
  .notes {
    width: 100%;
    border: none;
    outline: none;
    resize: none;
    background: transparent;
    color: var(--text-2);
    font-size: 13.5px;
    padding: 2px 0 6px;
  }
  .checklist {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
  }
  .checklist li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    border-top: 1px solid var(--line);
    font-size: 13.5px;
  }
  .checklist li .checked {
    color: var(--text-3);
    text-decoration: line-through;
  }
  .checklist li span {
    flex: 1;
  }
  .checklist .add {
    color: var(--text-3);
  }
  .checklist .add input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 13.5px;
  }
  .x {
    color: var(--text-3);
    font-size: 14px;
    line-height: 1;
    padding: 0 3px;
    display: none;
  }
  li:hover .x,
  .chip:hover .x {
    display: inline;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .chips {
    flex: 1;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    font-weight: 500;
    background: var(--chip);
    border-radius: 6px;
    padding: 2px 8px;
  }
  .deadline-chip {
    color: var(--deadline);
  }
  .actions {
    display: flex;
    gap: 2px;
  }
  .actions button {
    width: 28px;
    height: 26px;
    border-radius: 6px;
    display: grid;
    place-items: center;
    color: var(--text-2);
    font-weight: 600;
    font-size: 13px;
  }
  .actions button:hover {
    background: var(--chip);
  }
  .actions button.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
</style>
