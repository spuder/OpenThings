<script lang="ts">
  import { untrack } from 'svelte';
  import { fly, fade, slide } from 'svelte/transition';
  import { store } from '../store.svelte';
  import { parseQuickAdd, projectFragment, setProject, tagCompletion, type TokenKind } from '../parse';
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
  /** Caret position while it's a plain cursor (no selection) in the focused input; null otherwise. */
  let caret = $state<number | null>(null);
  let scrollX = $state(0);
  // The desktop window is the panel, so it doesn't animate: a remount there would briefly show the
  // old panel flying out next to the new one, and the text would jump.
  const panelIn = (node: Element) => (native ? { duration: 0 } : fly(node, { y: -10, duration: 180 }));

  const parsed = $derived(
    simple
      ? { ...parseQuickAdd('', store.day), title: value.trim(), dump: prefill.dump, dumpSection: prefill.dumpSection }
      : parseQuickAdd(value, store.day),
  );

  // Most used tags first; the built-in flags last.
  const tagNames = $derived.by(() => {
    const uses = new Map<string, number>();
    for (const tt of store.taskTags) uses.set(tt.tag_id, (uses.get(tt.tag_id) ?? 0) + 1);
    const names = [...store.tags].sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0) || a.name.localeCompare(b.name)).map((t) => t.name);
    return [...names, 'urgent', 'important'];
  });

  // Inline tag completion: the rest of the best match shows as ghost text after the cursor. It's
  // never inserted while you type, so the cursor stays put; Tab takes one step, → takes it all.
  const completion = $derived(simple || caret === null ? null : tagCompletion(value, caret, tagNames));

  // Project picker: typing `+` (or `+Gar`) lists projects and areas, ↑/↓ moves, ↵ or ⇥ picks.
  // A to-do has one project, so picking replaces any other +Project, such as the pre-filled one.
  // Not in the desktop quick-add window: it's one line tall.
  const fragment = $derived(simple || native || caret === null ? null : projectFragment(value, caret));
  const norm = (s: string) => s.toLowerCase().replace(/[-_\s]+/g, ' ').trim();
  /** The project set elsewhere in the text, which the picker would replace. */
  const currentProject = $derived.by(() => {
    if (!fragment) return null;
    const rest = value.slice(0, fragment.start) + value.slice(fragment.start + 1 + fragment.typed.length);
    return parseQuickAdd(rest, store.day).project;
  });
  /** Esc closes the list for the `+` it was open for; typing another `+` opens it again. */
  let pickerClosedAt = $state<number | null>(null);
  const picker = $derived.by(() => {
    if (!fragment || pickerClosedAt === fragment.start) return [];
    const q = norm(fragment.typed);
    const cur = currentProject && norm(currentProject);
    const all = [
      ...store.projects.filter((p) => !p.completed_at).map((p) => ({ name: p.name, area: false })),
      ...store.areas.map((a) => ({ name: a.name, area: true })),
    ]
      .filter((c) => norm(c.name).includes(q))
      .sort((a, b) => Number(!norm(b.name).startsWith(q)) - Number(!norm(a.name).startsWith(q)));
    return all.slice(0, 8).map((c) => ({ ...c, current: !!cur && norm(c.name) === cur }));
  });
  let pick = $state(0);
  // Each time the list opens or its matches change, start on the current project (else the best match).
  $effect(() => {
    const i = picker.findIndex((c) => c.current);
    pick = i >= 0 ? i : 0;
  });

  function choose(name: string) {
    if (!fragment) return;
    const r = setProject(value, fragment, name);
    value = r.text;
    caret = r.caret;
    placeCursor(r.caret);
  }

  function syncCaret() {
    if (!input) return;
    const { selectionStart: a, selectionEnd: b } = input;
    caret = a !== null && a === b && document.activeElement === input ? a : null;
    scrollX = input.scrollLeft;
  }

  /** Replace the partial tag with `to`; a finished tag from Tab gets a space so you can type on. */
  function complete(to: string, spaceIfDone: boolean) {
    const c = completion; // re-derives as soon as value changes
    if (!c) return;
    const end = c.start + c.typed.length;
    const rest = value.slice(end);
    const done = spaceIfDone && to === c.suggestion;
    value = value.slice(0, c.start) + to + (done && !rest.startsWith(' ') ? ' ' : '') + rest;
    caret = c.start + to.length + (done ? 1 : 0);
    placeCursor(caret);
  }

  /** ↵ would add a to-do (with the project list open it picks a project instead). */
  const ready = $derived(!!parsed.title && !picker.length);

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

  // Syntax keys: shown in the hint line while empty, each in the color of the chip it makes, then as
  // tappable chips below the input once you type.
  const keys: { label: string; insert: string; kind: TokenKind }[] = [
    { label: '#tag', insert: '#', kind: 'tag' },
    { label: '+Project', insert: '+', kind: 'project' },
    { label: '@tomorrow', insert: '@', kind: 'when' },
    { label: '%9am', insert: '%', kind: 'reminder' },
    { label: '!fri', insert: '!', kind: 'deadline' },
    { label: '~30m', insert: '~', kind: 'estimate' },
    { label: '*weekly', insert: '*', kind: 'repeat' },
    { label: '@dump', insert: '@dump ', kind: 'dump' },
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
    const plain = !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (picker.length && plain && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      pick = (pick + (e.key === 'ArrowDown' ? 1 : -1) + picker.length) % picker.length;
      return;
    }
    if (picker.length && plain && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault();
      choose(picker[pick].name);
      return;
    }
    if (picker.length && fragment && e.key === 'Escape') {
      e.preventDefault();
      pickerClosedAt = fragment.start;
      return;
    }
    if (completion && e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      complete(completion.step, true);
    } else if (completion && e.key === 'ArrowRight' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      complete(completion.suggestion, false);
    } else if (e.key === 'Escape') {
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
<div class="panel" class:native transition:panelIn role="dialog" aria-label="Quick add" aria-modal="true">
  <div class="field">
    <input
      bind:this={input}
      bind:value
      class:ghosted={!!completion}
      onkeydown={onKey}
      oninput={syncCaret}
      onkeyup={syncCaret}
      onpointerup={syncCaret}
      onselect={syncCaret}
      onfocus={syncCaret}
      onblur={() => (caret = null)}
      onscroll={syncCaret}
      placeholder={simple ? 'Write anything…' : 'New to-do'}
      spellcheck="false"
      autocomplete="off"
      aria-label="New to-do"
      aria-autocomplete="inline"
      aria-expanded={picker.length > 0}
      aria-controls="qa-projects"
    />
    {#if completion}
      <!-- Draws the whole line with the ghost spliced in; the input's own text is hidden meanwhile. -->
      <div class="ghost" aria-hidden="true"><span style:transform="translateX({-scrollX}px)"><span class="text">{value.slice(0, caret ?? 0)}</span>{completion.ghost}<span class="text">{value.slice(caret ?? 0)}</span></span></div>
    {/if}
  </div>
  {#if picker.length}
    <ul class="picker" id="qa-projects" role="listbox" aria-label="Projects" transition:slide={{ duration: 120 }}>
      {#each picker as c, i (c.name + c.area)}
        <li role="option" aria-selected={i === pick}>
          <button type="button" class:active={i === pick} onpointerdown={(e) => e.preventDefault()} onpointerenter={() => (pick = i)} onclick={() => choose(c.name)}>
            <span class="pname">{c.name}</span>
            {#if c.current}<span class="phint">current</span>{:else if c.area}<span class="phint">area</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <!-- Tappable syntax chips are for touch; the desktop quick-add window is keyboard-only and small. -->
  {#if value && !simple && !native}
    <div class="keys" transition:slide={{ duration: 160 }}>
      {#if completion}
        <!-- Touch has no Tab or →: tap the suggestion to take the whole tag and keep typing. -->
        <button
          type="button"
          class="key suggest"
          in:fade={{ duration: 120 }}
          onpointerdown={(e) => e.preventDefault()}
          onclick={() => complete(completion.suggestion, true)}
          aria-label={`Complete tag #${completion.suggestion}`}>#{completion.suggestion}</button
        >
      {/if}
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
  {#if !native}
  <div class="keys flags">
    <button type="button" class="key flag" class:on={parsed.important} style:--c="var(--important)" onpointerdown={(e) => e.preventDefault()} onclick={() => toggleFlag('important')} aria-pressed={parsed.important}>#important</button>
    <button type="button" class="key flag" class:on={parsed.urgent} style:--c="var(--urgent)" onpointerdown={(e) => e.preventDefault()} onclick={() => toggleFlag('urgent')} aria-pressed={parsed.urgent}>#urgent</button>
  </div>
  {/if}
  <div class="preview">
    {#if parsed.title}
      <span class="title">{parsed.title}</span>
    {:else}
      <span class="hint">Prefixes</span>
      {#each keys as k (k.label)}<span class="hint-key" style:color={tokenColor[k.kind]}>{k.label}</span>{/each}
    {/if}
    {#each parsed.tokens as t, i (i)}
      <span class="tok" style:--c={tokenColor[t.kind]} in:fly={{ y: 4, duration: 120 }}>{tokenPrefix[t.kind]}{label(t.kind, t.label)}</span>
    {/each}
    {#if contextLabel && parsed.title}<span class="ctx">→ {contextLabel}</span>{/if}
    {#each parsed.warnings as w}<span class="warn">{w}</span>{/each}
  </div>
  {/if}
  <div class="foot">
    <button type="button" class="touch-btn" onclick={close}>Cancel</button>
    {#if parsed.notes}<span class="notes">Notes: {parsed.notes}</span>{/if}
    {#if added}<span class="added" in:fade>{added} added</span>{/if}
    <!-- Keyboard hints sit bottom right, ↵ last; they light up once there's a to-do to add. -->
    <span class="kbs">
      {#if picker.length}<span class="kb"><kbd>↑↓</kbd> project <kbd>↵</kbd> pick</span>{/if}
      {#if completion}<span class="kb"><kbd>⇥</kbd> #{completion.step}</span>{/if}
      <span class="kb"><kbd>Esc</kbd> close</span>
      <span class="kb another" class:ready><kbd>⇧↵</kbd> add another</span>
      <span class="kb go" class:ready><kbd>↵</kbd> add</span>
    </span>
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
  /* macOS: the window is transparent, so the panel draws its own corners and edge. */
  :global(html.transparent-window) .panel.native {
    border-radius: 12px;
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .field {
    position: relative;
  }
  input,
  .ghost {
    width: 100%;
    border: none;
    outline: none;
    background: transparent;
    font-size: 18px;
    font-weight: 500;
    /* 16px+ prevents iOS zoom on focus. */
    padding: 4px 0 8px;
  }
  .ghost {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
    white-space: pre;
    color: var(--text-3);
  }
  .ghost > span {
    display: inline-block;
  }
  .ghost .text {
    color: var(--text);
  }
  input {
    caret-color: var(--accent);
  }
  input.ghosted {
    color: transparent;
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
  .hint-key {
    font-weight: 500;
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
  .picker {
    list-style: none;
    margin: 6px 0 2px;
    padding: 4px;
    border-radius: 8px;
    background: var(--bg);
    box-shadow: inset 0 0 0 1px var(--line);
    max-height: 264px;
    overflow-y: auto;
  }
  .picker button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 0 10px;
    border-radius: 6px;
    text-align: left;
    color: var(--text);
  }
  .picker button.active {
    background: var(--select);
  }
  .pname {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .phint {
    font-size: 12px;
    color: var(--text-3);
  }
  @media (pointer: coarse) {
    .picker button {
      min-height: 44px;
    }
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
  .key.suggest {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    font-weight: 600;
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
    color: var(--logbook);
    font-weight: 600;
  }
  .kbs {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .kb {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    transition: color 0.15s;
  }
  .kb kbd {
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .kb.another.ready {
    color: var(--accent);
  }
  .kb.another.ready kbd {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .kb.go {
    padding: 3px 10px 3px 4px;
    border-radius: 8px;
    background: var(--chip);
    transition: background 0.15s, color 0.15s;
  }
  .kb.go.ready {
    background: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  .kb.go.ready kbd {
    color: #fff;
    background: rgba(255, 255, 255, 0.18);
    border-color: rgba(255, 255, 255, 0.3);
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
    .key.suggest {
      min-height: 44px;
    }
    .keys {
      align-items: center;
    }
    /* No Esc or Enter keys to point at: real buttons instead. */
    .kbs {
      display: none;
    }
    .added {
      margin-left: auto;
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
    .added ~ .add-btn {
      margin-left: 0;
    }
    /* The desktop quick-add window is narrow but isn't a phone: keep the keyboard hints. */
    .native .kbs {
      display: flex;
    }
    .native .added {
      margin-left: 0;
    }
    .native .touch-btn {
      display: none;
    }
  }
</style>
