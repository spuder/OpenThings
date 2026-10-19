<script lang="ts">
  import { untrack } from 'svelte';
  import { fly, fade, slide } from 'svelte/transition';
  import { store } from '../store.svelte';
  import { parseQuickAdd, type TokenKind } from '../parse';
  import { relLabel } from '../dates';

  /**
   * Set by the desktop app's floating quick-add window (src/lib/native/QuickAddWindow.svelte):
   * the text is handed to the main window, which adds it through the store. Default: add here.
   */
  let { native = null }: { native?: { submit(text: string, keepOpen: boolean): void; close(): void } | null } = $props();

  // Brain Dump is for getting things out of your head: a plain box, no syntax, chips or tags.
  // The text is kept literally. Opened elsewhere with @dump (B), it still lands in the dump.
  const prefill = parseQuickAdd(store.quickAddPrefill, store.day);
  const simple = $derived(!native && (store.view.kind === 'dump' || prefill.dump));
  let value = $state((() => (simple ? '' : store.quickAddPrefill))());
  // Opened with the current list pre-filled (+Project, @today): that text is the context now, so
  // deleting it sends the to-do to the Inbox instead of falling back to the current list.
  const context = store.quickAddPrefill && store.quickAddPrefill === store.contextToken() ? store.quickAddPrefill : '';
  let input: HTMLInputElement | undefined = $state();
  let added = $state(0);

  const parsed = $derived(
    simple
      ? { ...parseQuickAdd('', store.day), title: value.trim(), dump: prefill.dump, dumpSection: prefill.dumpSection }
      : parseQuickAdd(value, store.day),
  );

  const contextLabel = $derived.by(() => {
    if (parsed.project || parsed.when || parsed.dump) return null;
    if (native) return 'Inbox';
    if (context) return 'Inbox';
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

  // Focus once on open. A pre-filled list goes after the title, so the cursor starts in front of it.
  $effect(() => {
    if (!input) return;
    input.focus();
    untrack(() => placeCursor(context ? 0 : value.length));
  });

  function placeCursor(pos: number) {
    queueMicrotask(() => input?.setSelectionRange(pos, pos));
  }

  function label(kind: TokenKind, l: string) {
    if ((kind === 'when' || kind === 'deadline') && /^\d{4}-/.test(l)) return relLabel(l, store.day);
    return l;
  }

  function submit(keepOpen: boolean) {
    if (!parsed.title) return;
    if (native) native.submit(value, keepOpen);
    else store.addParsed(parsed, { useContext: !context });
    added++;
    value = keepOpen && !simple ? (parsed.dump ? `@dump${parsed.dumpSection ? '/' + parsed.dumpSection : ''} ` : context) : '';
    if (keepOpen) placeCursor(context ? 0 : value.length);
    else close();
  }

  // Syntax keys: shown in the placeholder while empty, then as tappable chips below the input once you type.
  const keys: { label: string; insert: string }[] = [
    { label: '#tag', insert: '#' },
    { label: '+Project', insert: '+' },
    { label: '@tomorrow', insert: '@' },
    { label: '%9am', insert: '%' },
    { label: '!fri', insert: '!' },
    { label: '~30m', insert: '~' },
    { label: '*weekly', insert: '*' },
    { label: '@dump', insert: '@dump ' },
  ];

  /** #urgent / #important: tap to add, tap again to remove. */
  function toggleFlag(name: 'urgent' | 'important') {
    // Goes at the end with the other tokens; the cursor stays where you're typing.
    const pos = input?.selectionStart ?? value.length;
    const re = new RegExp(`(^|\\s)#${name}(?=\\s|$)`, 'gi');
    if (re.test(value)) value = value.replace(re, '$1').replace(/\s{2,}/g, ' ');
    else value = value + (value && !value.endsWith(' ') ? ' ' : '') + `#${name}`;
    input?.focus();
    placeCursor(Math.min(pos, value.length));
  }

  function insertKey(text: string) {
    value = value + (value && !value.endsWith(' ') ? ' ' : '') + text;
    input?.focus();
    placeCursor(value.length);
  }

  function close() {
    (document.activeElement as HTMLElement | null)?.blur();
    if (native) return native.close();
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
    reminder: 'var(--habits)',
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
    reminder: 'Remind ',
  };
</script>

{#if !native}<div class="scrim" transition:fade={{ duration: 120 }} onclick={close} onkeydown={() => {}} role="presentation"></div>{/if}
<div class="panel" class:native transition:fly={{ y: -10, duration: 180 }} role="dialog" aria-label="Quick add" aria-modal="true">
  <input
    bind:this={input}
    bind:value
    onkeydown={onKey}
    placeholder={simple ? 'Write anything…' : `New to-do   ${keys.map((k) => k.label).join('  ')}`}
    spellcheck="false"
    aria-label="New to-do"
  />
  {#if value && !simple}
    <div class="keys" transition:slide={{ duration: 160 }}>
      {#each keys as k, i (k.label)}
        <button
          type="button"
          class="key"
          in:fly={{ y: -10, duration: 180, delay: i * 18 }}
          onpointerdown={(e) => e.preventDefault()}
          onclick={() => insertKey(k.insert)}
          aria-label={`Insert ${k.label}`}>{k.label}</button
        >
      {/each}
    </div>
  {/if}
  {#if !simple}
  <div class="keys flags">
    <button type="button" class="key flag" class:on={parsed.important} style:--c="var(--important)" onpointerdown={(e) => e.preventDefault()} onclick={() => toggleFlag('important')} aria-pressed={parsed.important}>#important</button>
    <button type="button" class="key flag" class:on={parsed.urgent} style:--c="var(--urgent)" onpointerdown={(e) => e.preventDefault()} onclick={() => toggleFlag('urgent')} aria-pressed={parsed.urgent}>#urgent</button>
  </div>
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
  {/if}
  <div class="foot">
    <span class="kb"><kbd>↵</kbd> add</span>
    <span class="kb"><kbd>⇧↵</kbd> add another</span>
    <span class="kb"><kbd>Esc</kbd> close</span>
    <button type="button" class="touch-btn" onclick={close}>Cancel</button>
    {#if parsed.notes}<span class="notes">Notes: {parsed.notes}</span>{/if}
    {#if added}<span class="added" in:fade>{added} added</span>{/if}
    <button type="button" class="touch-btn add-btn" disabled={!parsed.title} onclick={() => submit(false)}>Add</button>
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
  /* Desktop quick-add window: the panel is the whole (frameless) window. */
  .panel.native {
    position: static;
    width: 100%;
    transform: none;
    border-radius: 0;
    box-shadow: none;
    min-height: 100vh;
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
  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 2px 0 10px;
  }
  .key {
    font-size: 12.5px;
    color: var(--text-2);
    background: var(--chip);
    border-radius: 7px;
    padding: 3px 8px;
  }
  .key:hover {
    color: var(--text);
  }
  .key.flag {
    color: var(--c);
    background: transparent;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 45%, transparent);
    transition: background 0.12s, color 0.12s;
  }
  .key.flag.on {
    color: #fff;
    background: var(--c);
  }
  .touch-btn {
    display: none;
  }
  .added {
    margin-left: auto;
    color: var(--logbook);
    font-weight: 600;
  }
  @media (max-width: 760px) {
    .panel {
      /* About two thirds up the screen: in thumb reach, still clear of the on-screen keyboard. */
      top: 30dvh;
      width: calc(100vw - 16px);
    }
    /* Keyboard up: sit right on top of it so the buttons are never hidden. */
    :global(html.kb-open) .panel {
      top: auto;
      bottom: calc(var(--kb) + 8px);
      max-height: calc(100dvh - var(--kb) - env(safe-area-inset-top) - 16px);
      overflow-y: auto;
    }
    .key {
      font-size: 14px;
      padding: 7px 11px;
    }
    /* No Esc or Enter keys to point at: real buttons instead. */
    .kb {
      display: none;
    }
    .touch-btn {
      display: block;
      min-height: 40px;
      padding: 0 14px;
      border-radius: 9px;
      font-size: 15px;
      color: var(--text-2);
    }
    .add-btn {
      margin-left: auto;
      background: var(--accent);
      color: #fff;
      font-weight: 600;
    }
    .add-btn:disabled {
      opacity: 0.4;
    }
    .added + .add-btn {
      margin-left: 0;
    }
  }
</style>
