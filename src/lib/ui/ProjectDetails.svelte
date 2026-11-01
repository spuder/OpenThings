<script module lang="ts">
  /** Swatches offered for a project's color. `null` means the theme accent. */
  export const PROJECT_COLORS: (string | null)[] = [null, '#e5484d', '#f76b15', '#ffc53d', '#30a46c', '#12a594', '#0090ff', '#6e56cf', '#d6409f', '#8d8d8d'];
</script>

<script lang="ts">
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { store } from '../store.svelte';
  import type { Project } from '../types';
  import { LINK_TYPE_NAMES, linkTitle, normalizeLink, type LinkType } from '../projectLinks';

  let { project }: { project: Project } = $props();

  const links = $derived(store.linksOf(project.id));
  let adding = $state(false);
  let url = $state('');
  let label = $state('');
  const valid = $derived(!url.trim() || !!normalizeLink(url));

  // Simple line glyphs, one per link type (16×16 viewBox).
  const glyph: Record<LinkType, string> = {
    github: 'M5 3a1.6 1.6 0 1 0 0 .01M5 13a1.6 1.6 0 1 0 0 .01M11 6a1.6 1.6 0 1 0 0 .01M5 4.6v6.8M11 7.6c0 2-6 1.4-6 3.8',
    gitlab: 'M8 13.5 2.5 9l1.6-6 1.6 4.2h4.6L11.9 3l1.6 6Z',
    file: 'M2 4.5h4l1.3 1.5H14v6.5H2Z',
    editor: 'M6 4 2 8l4 4M10 4l4 4-4 4',
    obsidian: 'M8 2 12.5 6 11 13H5L3.5 6Z',
    youtube: 'M2 5.5c0-1 .8-1.8 1.8-1.8h8.4c1 0 1.8.8 1.8 1.8v5c0 1-.8 1.8-1.8 1.8H3.8c-1 0-1.8-.8-1.8-1.8ZM6.8 6v4L10 8Z',
    chatgpt: 'M3 4h10v6.5H7L4 13v-2.5H3Z',
    claude: 'M3 4h10v6.5H7L4 13v-2.5H3Z',
    grok: 'M3 4h10v6.5H7L4 13v-2.5H3Z',
    app: 'M9 2.5H13.5V7M13.5 2.5 7.5 8.5M12 9.5v4H2.5V4h4',
    web: 'M8 2a6 6 0 1 0 0 12A6 6 0 1 0 8 2M2 8h12M8 2c-2.2 2.5-2.2 9.5 0 12M8 2c2.2 2.5 2.2 9.5 0 12',
  };
  const tint: Record<LinkType, string> = {
    github: 'var(--text)', gitlab: '#fc6d26', file: 'var(--anytime)', editor: 'var(--inbox)', obsidian: '#7c3aed',
    youtube: '#e5484d', chatgpt: '#10a37f', claude: '#d97757', grok: 'var(--text)', app: 'var(--matrix)', web: 'var(--text-2)',
  };
  const typeOf = (t: string): LinkType => (t in glyph ? (t as LinkType) : 'web');

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!url.trim() || !valid) return;
    if (store.addProjectLink(project.id, url, label)) {
      url = '';
      label = '';
      adding = false;
    }
  }

  /** Web links open in a new tab. Paths and app schemes go to the OS, which may or may not handle them. */
  function href(u: string): string {
    if (/^(~|\/(?!\/)|[a-zA-Z]:[\\/]|\\\\)/.test(u)) return `file://${u.replace(/\\/g, '/').replace(/^(?=[a-zA-Z]:)/, '/')}`;
    return u;
  }
  function copy(u: string) {
    navigator.clipboard?.writeText(u).then(() => store.notify('Copied'), () => {});
  }
</script>

<aside class="details" transition:fly={{ x: 320, duration: 220, easing: cubicOut }} aria-label="Project details">
  <header>
    <h2>Details</h2>
    <button class="close" onclick={() => (store.detailsOpen = false)} aria-label="Close details" title="Close">✕</button>
  </header>

  <section>
    <h3>Color</h3>
    <div class="swatches" role="radiogroup" aria-label="Project color">
      {#each PROJECT_COLORS as c (c)}
        <button
          class="swatch"
          class:none={!c}
          class:on={(project.color ?? null) === c}
          style:--c={c ?? 'var(--accent)'}
          role="radio"
          aria-checked={(project.color ?? null) === c}
          aria-label={c ?? 'Default color'}
          title={c ?? 'Default (theme accent)'}
          onclick={() => store.setProjectColor(project.id, c)}
        ></button>
      {/each}
    </div>
  </section>

  <section>
    <h3>Links</h3>
    {#if links.length}
      <ul class="links">
        {#each links as l, i (l.id)}
          {@const t = typeOf(l.type)}
          <li>
            <svg class="ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" style:color={tint[t]}>
              <path d={glyph[t]} fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <a href={href(l.url)} target="_blank" rel="noopener noreferrer" title={`${LINK_TYPE_NAMES[t]} · ${l.url}`}>{linkTitle(l)}</a>
            <span class="acts">
              <button onclick={() => copy(l.url)} aria-label="Copy link" title="Copy">⧉</button>
              <button onclick={() => store.moveProjectLink(l.id, -1)} disabled={i === 0} aria-label="Move up" title="Move up">↑</button>
              <button onclick={() => store.moveProjectLink(l.id, 1)} disabled={i === links.length - 1} aria-label="Move down" title="Move down">↓</button>
              <button class="rm" onclick={() => store.removeProjectLink(l.id)} aria-label={`Remove ${linkTitle(l)}`} title="Remove">✕</button>
            </span>
          </li>
        {/each}
      </ul>
    {:else if !adding}
      <p class="empty">Repos, issues, folders, notes, conversations: keep them with the project.</p>
    {/if}

    {#if adding}
      <form onsubmit={submit} class="add">
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={url} placeholder="URL or path" aria-label="URL or path" aria-invalid={!valid} class:bad={!valid} autofocus required
          onkeydown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); adding = false; } }} />
        <input bind:value={label} placeholder="Label (optional)" aria-label="Label" />
        {#if !valid}<p class="err">Enter a URL (https://…, vscode://…) or a path (~/…, /…, C:\…).</p>{/if}
        <div class="row">
          <button type="submit" class="primary" disabled={!url.trim() || !valid}>Add</button>
          <button type="button" onclick={() => { adding = false; url = ''; label = ''; }}>Cancel</button>
        </div>
      </form>
    {:else}
      <button class="add-btn" onclick={() => (adding = true)}>+ add link</button>
    {/if}
  </section>
</aside>

<style>
  .details {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(300px, 100vw);
    z-index: 40;
    background: var(--bg-2, var(--bg));
    border-left: 1px solid var(--line, rgba(127, 127, 127, 0.2));
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.08);
    padding: calc(14px + env(safe-area-inset-top)) 16px 16px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { font-size: 15px; margin: 0; }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-2); margin: 0 0 8px; }
  button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; border-radius: 6px; }
  .close { padding: 4px 8px; color: var(--text-2); }
  .close:hover { background: var(--accent-soft); }
  .swatches { display: flex; flex-wrap: wrap; gap: 8px; }
  .swatch { width: 22px; height: 22px; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12); }
  .swatch.none { background: transparent; box-shadow: inset 0 0 0 2px var(--c); }
  .swatch.on { outline: 2px solid var(--c); outline-offset: 2px; }
  .links { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .links li { display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 6px; min-width: 0; }
  .links li:hover { background: var(--accent-soft); }
  .ico { flex: none; }
  .links a { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); text-decoration: none; font-size: 14px; }
  .links a:hover { text-decoration: underline; }
  .acts { display: flex; gap: 0; opacity: 0; transition: opacity 0.12s; }
  .links li:hover .acts, .links li:focus-within .acts { opacity: 1; }
  @media (hover: none) { .acts { opacity: 1; } }
  .acts button { padding: 2px 5px; color: var(--text-2); font-size: 12px; }
  .acts button:disabled { opacity: 0.3; cursor: default; }
  .acts .rm:hover { color: var(--deadline); }
  .empty { color: var(--text-2); font-size: 13px; margin: 0 0 6px; }
  .add-btn { color: var(--accent); padding: 4px 6px; font-size: 14px; }
  .add { display: flex; flex-direction: column; gap: 6px; }
  .add input { font: inherit; font-size: 14px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--line, rgba(127, 127, 127, 0.3)); background: var(--bg); color: var(--text); }
  .add input.bad { border-color: var(--deadline); }
  .err { color: var(--deadline); font-size: 12px; margin: 0; }
  .add .row { display: flex; gap: 6px; }
  .add .row button { padding: 5px 12px; font-size: 13px; border: 1px solid var(--line, rgba(127, 127, 127, 0.3)); }
  .add .primary { background: var(--accent); color: white; border-color: transparent; }
  .add .primary:disabled { opacity: 0.5; }
</style>
