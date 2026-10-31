<script lang="ts">
  /**
   * Inline assignment box for a time block (#99): area, then project, then to-do, one step at a time.
   * Type to autocomplete, Enter or Tab accepts, ↑ / ↓ pick another suggestion, Escape or clicking
   * away stops at the level reached. Backspace in an empty box steps back up a level. No dialog.
   */
  import { untrack } from 'svelte';
  import { store } from '../store.svelte';
  import * as TB from '../timeblocks';
  import type { TimeBlock } from '../types';

  let { block }: { block: TimeBlock } = $props();

  const placeholders: Record<TB.Level, string> = {
    area: 'Area or name…',
    project: 'Project (optional)…',
    task: 'To-do (optional)…',
  };

  const assigned: TB.Assignment = $derived({ area_id: block.area_id, project_id: block.project_id, task_id: block.task_id });
  const level = $derived(TB.nextLevel(assigned));
  // A generic block opens with its name in the box, so typing over it renames it.
  let query = $state(untrack(() => (block.area_id ? '' : (block.title ?? ''))));
  let index = $state(-1);
  let input: HTMLInputElement | undefined = $state();

  const options = $derived(level ? TB.matchOptions(TB.optionsFor(level, assigned, store.areas, store.projects, store.tasks), query) : []);
  const shown = $derived(options.slice(0, 6));
  // Typing highlights the best match; with an empty box, nothing is picked until ↓.
  const picked = $derived(index >= 0 ? shown[index] : undefined);
  const completion = $derived(TB.inlineCompletion(picked?.name, query));

  $effect(() => {
    input?.focus();
    input?.select();
  });

  function close() {
    if (store.blockEditingId === block.id) store.blockEditingId = null;
  }

  function accept(id: string) {
    if (!level) return;
    const next = { ...assigned, [`${level}_id`]: id } as TB.Assignment;
    if (!store.assignBlock(block.id, next)) return;
    query = '';
    index = -1;
    if (!TB.nextLevel(next)) close();
  }

  function stepUp() {
    const deepest = TB.levelOf(assigned);
    if (deepest) store.assignBlock(block.id, TB.clearFrom(assigned, deepest));
    else if (block.title) store.assignBlock(block.id, assigned, null);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (picked) return accept(picked.id);
      // Text that isn't an area: a plain named block, like "Taxes".
      if (level === 'area' && query.trim() !== (block.title ?? '')) store.assignBlock(block.id, assigned, query);
      close();
    } else if (e.key === 'Tab' && picked) {
      e.preventDefault();
      accept(picked.id);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      index = Math.min(index + 1, shown.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      index = Math.max(index - 1, -1);
    } else if (e.key === 'Backspace' && !query) {
      e.preventDefault();
      stepUp();
    }
  }

  function oninput() {
    index = query.trim() ? 0 : -1;
  }
</script>

<div class="assign" data-no-drag>
  <div class="field">
    <span class="ghost" aria-hidden="true"><span class="typed">{query}</span>{completion}</span>
    <input
      bind:this={input}
      bind:value={query}
      {oninput}
      {onkeydown}
      onblur={close}
      placeholder={level ? placeholders[level] : 'Done'}
      aria-label={level ? `Assign block: ${level}` : 'Block assignment'}
      aria-autocomplete="inline"
      role="combobox"
      aria-expanded={shown.length > 0}
      aria-controls="block-assign-list"
      autocomplete="off"
      spellcheck="false"
    />
  </div>
  {#if shown.length && level}
    <ul class="suggest" id="block-assign-list" role="listbox">
      {#each shown as o, i (o.id)}
        <li role="option" aria-selected={i === index}>
          <!-- pointerdown, not click: the box must not blur (and close) first. -->
          <button type="button" class:on={i === index} onpointerdown={(e) => { e.preventDefault(); accept(o.id); }} tabindex="-1">{o.name}</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .assign {
    position: relative;
    margin-top: 3px;
  }
  .field {
    position: relative;
  }
  input,
  .ghost {
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    line-height: 18px;
    padding: 2px 5px;
    width: 100%;
    box-sizing: border-box;
  }
  input {
    position: relative;
    background: color-mix(in srgb, var(--card) 85%, transparent);
    border: 1px solid var(--line-strong);
    border-radius: 5px;
    color: var(--text);
    outline: none;
  }
  input:focus {
    border-color: var(--accent);
  }
  .ghost {
    position: absolute;
    inset: 0;
    border: 1px solid transparent;
    color: var(--text-3);
    white-space: pre;
    overflow: hidden;
    pointer-events: none;
    z-index: 1;
  }
  .typed {
    visibility: hidden;
  }
  .suggest {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    min-width: 100%;
    width: max-content;
    max-width: 240px;
    margin: 0;
    padding: 3px;
    list-style: none;
    background: var(--card);
    border-radius: 7px;
    box-shadow: var(--card-shadow), 0 0 0 1px var(--line);
    z-index: 5;
  }
  .suggest button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 4px 8px;
    border-radius: 5px;
    font-size: 12.5px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .suggest button.on,
  .suggest button:hover {
    background: var(--select);
  }
  @media (pointer: coarse) {
    .suggest button {
      min-height: 44px;
    }
    input,
    .ghost {
      font-size: 16px; /* no iOS zoom on focus */
      line-height: 24px;
    }
  }
</style>
