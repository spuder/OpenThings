<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import { store } from '../store.svelte';
  import { theme, type ThemePref } from '../theme.svelte';
  import { omarchyThemes } from '../omarchy-themes';

  interface Choice {
    id: string;
    name: string;
    kind: 'base' | 'omarchy';
    pref?: ThemePref;
    /** Colors for the mini preview card. */
    c: { bg: string; side: string; fg: string; dim: string; accent: string; swatches: string[] };
  }

  const base: Choice[] = [
    {
      id: 'system',
      name: 'System',
      kind: 'base',
      pref: 'system',
      c: { bg: 'linear-gradient(135deg, #ffffff 50%, #1d1e21 50%)', side: '#f3f3f5', fg: '#1c1c1e', dim: '#a1a1a6', accent: '#2f6fed', swatches: ['#e0453c', '#f2b72e', '#3fa66b', '#2f6fed', '#8a63d2', '#2aa198'] },
    },
    {
      id: 'light',
      name: 'Light',
      kind: 'base',
      pref: 'light',
      c: { bg: '#ffffff', side: '#f3f3f5', fg: '#1c1c1e', dim: '#a1a1a6', accent: '#2f6fed', swatches: ['#e0453c', '#f2b72e', '#3fa66b', '#2f6fed', '#8a63d2', '#2aa198'] },
    },
    {
      id: 'dark',
      name: 'Dark',
      kind: 'base',
      pref: 'dark',
      c: { bg: '#1d1e21', side: '#17181a', fg: '#ececef', dim: '#67676f', accent: '#5b8ff9', swatches: ['#e0453c', '#f2b72e', '#3fa66b', '#5b8ff9', '#8a63d2', '#2aa198'] },
    },
  ];
  const choices: Choice[] = [
    ...base,
    ...omarchyThemes.map((p) => ({
      id: p.id,
      name: p.name,
      kind: 'omarchy' as const,
      c: { bg: p.background, side: p.dark_background, fg: p.foreground, dim: p.dark_foreground, accent: p.accent, swatches: [p.red, p.yellow, p.green, p.blue, p.magenta, p.cyan] },
    })),
  ];

  const currentId = theme.omarchy ?? theme.pref;
  let index = $state(Math.max(0, choices.findIndex((c) => c.id === currentId)));
  let grid: HTMLElement | undefined = $state();
  const COLS = 4;

  function preview(i: number) {
    const c = choices[i];
    if (!c) return;
    // Base choices preview by clearing the Omarchy palette; light/dark show via the stored pref.
    theme.preview(c.kind === 'omarchy' ? c.id : null);
  }

  $effect(() => {
    preview(index);
    grid?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  });

  function choose(i: number) {
    const c = choices[i];
    if (!c) return;
    if (c.kind === 'omarchy') theme.setOmarchy(c.id);
    else theme.set(c.pref!);
    store.overlay = null;
    store.notify(`Theme: ${c.name}`);
  }

  function cancel() {
    theme.preview(undefined);
    store.overlay = null;
  }

  function onKey(e: KeyboardEvent) {
    const k = e.key;
    if (k === 'Escape' || (k === 'T' && e.shiftKey)) cancel();
    else if (k === 'Enter' || k === ' ') choose(index);
    else if (k === 'ArrowRight' || k === 'l') index = Math.min(choices.length - 1, index + 1);
    else if (k === 'ArrowLeft' || k === 'h') index = Math.max(0, index - 1);
    else if (k === 'ArrowDown' || k === 'j') index = Math.min(choices.length - 1, index + COLS);
    else if (k === 'ArrowUp' || k === 'k') index = Math.max(0, index - COLS);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="scrim" transition:fade={{ duration: 120 }} onclick={cancel} onkeydown={() => {}} role="presentation"></div>
<div class="panel" transition:scale={{ start: 0.97, duration: 160 }} role="dialog" aria-modal="true" aria-label="Choose a theme">
  <header>
    <h2>Theme</h2>
    <span class="hint"><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> preview · <kbd>↵</kbd> choose · <kbd>Esc</kbd> cancel</span>
  </header>
  <div class="grid" bind:this={grid} role="listbox" aria-label="Themes" style:--cols={COLS}>
    {#each choices as c, i (c.id)}
      <button
        class="tile"
        class:active={i === index}
        class:current={c.id === currentId}
        data-i={i}
        role="option"
        aria-selected={i === index}
        onclick={() => choose(i)}
        onmouseenter={() => (index = i)}
      >
        <span class="mini" style:background={c.c.bg} aria-hidden="true">
          <span class="mini-side" style:background={c.c.side}>
            <span style:background={c.c.accent}></span><span style:background={c.c.dim}></span><span style:background={c.c.dim}></span>
          </span>
          <span class="mini-main">
            {#each [0.9, 0.7, 0.8] as w}
              <span class="mini-row"><span class="mini-box" style:border-color={c.c.dim}></span><span class="mini-line" style:background={c.c.fg} style:width={`${w * 70}%`}></span></span>
            {/each}
            <span class="mini-swatches">
              {#each c.c.swatches as s}<span style:background={s}></span>{/each}
            </span>
          </span>
        </span>
        <span class="name">{c.name}{#if c.id === currentId}<span class="tick">✓</span>{/if}</span>
      </button>
    {/each}
  </div>
  <footer>Omarchy themes are adapted from <a href="https://omarchy.org" target="_blank" rel="noreferrer">Omarchy</a> (MIT).</footer>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.25);
    z-index: 20;
  }
  .panel {
    position: fixed;
    top: 8vh;
    left: 50%;
    translate: -50% 0;
    width: min(880px, calc(100vw - 32px));
    max-height: 84vh;
    display: flex;
    flex-direction: column;
    z-index: 21;
    background: var(--card);
    border-radius: 16px;
    box-shadow: var(--card-shadow), 0 0 0 1px var(--line);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 20px 10px;
  }
  h2 {
    margin: 0;
    font-size: 17px;
  }
  .hint {
    font-size: 12px;
    color: var(--text-3);
  }
  .hint kbd {
    margin-right: 2px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(var(--cols), 1fr);
    gap: 14px;
    padding: 6px 20px 16px;
    overflow-y: auto;
  }
  .tile {
    display: grid;
    gap: 7px;
    padding: 6px;
    border-radius: 12px;
    text-align: left;
    outline: 2px solid transparent;
    transition:
      outline-color 0.12s,
      background 0.12s;
  }
  .tile.active {
    outline-color: var(--accent);
    background: var(--select);
  }
  .mini {
    display: flex;
    aspect-ratio: 16 / 10;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 0 0 1px var(--line);
  }
  .mini-side {
    width: 26%;
    padding: 9% 6%;
    display: grid;
    align-content: start;
    gap: 7px;
  }
  .mini-side span {
    height: 4px;
    border-radius: 2px;
    opacity: 0.9;
  }
  .mini-main {
    flex: 1;
    padding: 9% 8% 6%;
    display: grid;
    align-content: start;
    gap: 8px;
  }
  .mini-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .mini-box {
    width: 7px;
    height: 7px;
    border-radius: 2px;
    border: 1.2px solid;
    flex-shrink: 0;
  }
  .mini-line {
    height: 4px;
    border-radius: 2px;
    opacity: 0.85;
  }
  .mini-swatches {
    display: flex;
    gap: 4px;
    margin-top: 4px;
  }
  .mini-swatches span {
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }
  .name {
    font-size: 13px;
    font-weight: 600;
    padding: 0 2px;
    display: flex;
    justify-content: space-between;
  }
  .tick {
    color: var(--accent);
  }
  footer {
    padding: 10px 20px 14px;
    font-size: 12px;
    color: var(--text-3);
    border-top: 1px solid var(--line);
  }
  footer a {
    color: var(--accent);
  }
</style>
