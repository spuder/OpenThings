<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import { store } from '../store.svelte';
  import { parseQuickAdd, type TokenKind } from '../parse';
  import { relLabel } from '../dates';

  let value = $state(store.quickAddPrefill);
  let input: HTMLInputElement | undefined = $state();
  let added = $state(0);

  const parsed = $derived(parseQuickAdd(value, store.day));

  const contextLabel = $derived.by(() => {
    if (parsed.project || parsed.when || parsed.dump) return null;
    const v = store.view;
    switch (v.kind) {
      case 'today': return 'Today';
      case 'someday': return 'Someday';
      case 'dump': return 'Brain Dump';
      case 'project':
      case 'area': return store.viewTitle;
      default: return 'Inbox';
    }
  });

  $effect(() => {
    input?.focus();
    const end = value.length;
    input?.setSelectionRange(end, end);
  });

  function label(kind: TokenKind, l: string) {
    if ((kind === 'when' || kind === 'deadline') && /^\d{4}-/.test(l)) return relLabel(l, store.day);
    return l;
  }

  function submit(keepOpen: boolean) {
    if (!parsed.title) return;
    store.addParsed(parsed);
    added++;
    value = keepOpen ? (parsed.dump ? `@dump${parsed.dumpSection ? '/' + parsed.dumpSection : ''} ` : '') : '';
    if (!keepOpen) close();
  }

  function close() {
    (document.activeElement as HTMLElement | null)?.blur();
    store.overlay = null;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      submit(e.shiftKey || e.metaKey || e.ctrlKey);
    }
  }

  const tokenColor: Record<TokenKind, string> = {
    tag: 'var(--text-2)',
    project: 'var(--accent)',
    when: 'var(--star)',
    deadline: 'var(--deadline)',
    estimate: 'var(--anytime)',
    repeat: 'var(--matrix)',
    matrix: 'var(--urgent)',
    dump: 'var(--dump)',
  };
  const tokenPrefix: Record<TokenKind, string> = {
    tag: '#',
    project: '→ ',
    when: '',
    deadline: '⚑ ',
    estimate: '~',
    repeat: '↻ ',
    matrix: '',
    dump: '',
  };
</script>

<div class="scrim" transition:fade={{ duration: 120 }} onclick={close} onkeydown={() => {}} role="presentation"></div>
<div class="panel" transition:fly={{ y: -10, duration: 180 }} role="dialog" aria-label="Quick add" aria-modal="true">
  <input
    bind:this={input}
    bind:value
    onkeydown={onKey}
    placeholder="New to-do   #tag  +Project  @tomorrow  !fri  ~30m  *weekly  ^ui  @dump"
    spellcheck="false"
    aria-label="New to-do"
  />
  <div class="preview">
    {#if parsed.title}
      <span class="title">{parsed.title}</span>
    {:else}
      <span class="hint">Type a to-do. Prefixes set its list, dates and tags.</span>
    {/if}
    {#each parsed.tokens as t, i (i)}
      <span class="tok" style:--c={tokenColor[t.kind]} in:fly={{ y: 4, duration: 120 }}>{tokenPrefix[t.kind]}{label(t.kind, t.label)}</span>
    {/each}
    {#if contextLabel && parsed.title}<span class="ctx">→ {contextLabel}</span>{/if}
    {#each parsed.warnings as w}<span class="warn">{w}</span>{/each}
  </div>
  <div class="foot">
    <span><kbd>↵</kbd> add</span>
    <span><kbd>⇧↵</kbd> add another</span>
    <span><kbd>Esc</kbd> close</span>
    {#if parsed.notes}<span class="notes">Notes: {parsed.notes}</span>{/if}
    {#if added}<span class="added" in:fade>{added} added</span>{/if}
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.18);
    z-index: 20;
  }
  .panel {
    position: fixed;
    top: 14vh;
    left: 50%;
    width: min(640px, 92vw);
    transform: translateX(-50%);
    background: var(--card);
    border-radius: 12px;
    box-shadow: var(--card-shadow), 0 0 0 1px var(--line);
    z-index: 21;
    padding: 14px 16px 10px;
  }
  input {
    width: 100%;
    border: none;
    outline: none;
    background: transparent;
    font-size: 18px;
    font-weight: 500;
    /* 16px+ prevents iOS zoom on focus. */
    padding: 4px 0 8px;
  }
  input::placeholder {
    color: var(--text-3);
    font-weight: 400;
    font-size: 15px;
  }
  .preview {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-height: 26px;
    padding: 6px 0 10px;
    border-top: 1px solid var(--line);
    font-size: 13px;
  }
  .title {
    font-weight: 500;
    margin-right: 4px;
  }
  .hint,
  .ctx {
    color: var(--text-3);
  }
  .tok {
    color: var(--c);
    background: color-mix(in srgb, var(--c) 12%, transparent);
    border-radius: 6px;
    padding: 1px 7px;
    font-weight: 600;
    font-size: 12px;
  }
  .warn {
    color: var(--deadline);
    font-size: 12px;
  }
  .foot {
    display: flex;
    gap: 14px;
    align-items: center;
    color: var(--text-3);
    font-size: 12px;
  }
  .notes {
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 220px;
  }
  .added {
    margin-left: auto;
    color: var(--logbook);
    font-weight: 600;
  }
  @media (max-width: 760px) {
    .panel {
      top: calc(8px + env(safe-area-inset-top));
      width: calc(100vw - 16px);
    }
  }
</style>
