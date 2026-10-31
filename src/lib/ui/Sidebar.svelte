<script lang="ts">
  import { store } from '../store.svelte';
  import type { ViewKey } from '../types';
  import Icon from './Icon.svelte';
  import ProgressPie from './ProgressPie.svelte';
  import { isMac, keyLabel, openListMenu, prompt } from '../commands';
  import { fly, slide, type TransitionConfig } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { viewEnabled } from '../features.svelte';
  import { dropOn } from './drag.svelte';
  import { projectDrag, projectDraggable, projectDropLine } from './projectDrag.svelte';

  let newListOpen = $state(false);
  function newList(kind: 'project' | 'area') {
    newListOpen = false;
    if (kind === 'project') prompt('New project', (name) => store.go({ kind: 'project', id: store.addProject(name) }));
    else prompt('New area of responsibility', (name) => store.go({ kind: 'area', id: store.addArea(name) }));
  }

  const menu = (e: Event, kind: 'area' | 'project', id: string) => {
    e.preventDefault();
    e.stopPropagation();
    openListMenu({ kind, id });
  };

  const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** An area's projects open like a drawer: the height slides while the rows fade and drop into place. */
  function unfold(node: Element, { duration }: { duration: number }): TransitionConfig {
    const s = slide(node, { duration, easing: cubicOut });
    return {
      duration: reduceMotion ? 0 : duration,
      easing: cubicOut,
      css: (t, u) => `${s.css?.(t, u) ?? ''}opacity: ${t}; transform: translateY(${-6 * u}px);`,
    };
  }

  // Alt/Option-click folds or unfolds every area to match, like a Finder outline.
  const fold = (e: MouseEvent, id: string) => {
    if (e.altKey) store.setAreasCollapsed(!store.collapsedAreas.has(id));
    else store.toggleArea(id);
  };

  type NavItem = { v: ViewKey; label: string; icon: string; count?: boolean };
  const top: NavItem[][] = [
    [{ v: { kind: 'inbox' }, label: 'Inbox', icon: 'inbox', count: true }],
    [
      { v: { kind: 'today' }, label: 'Today', icon: 'today', count: true },
      { v: { kind: 'week' }, label: 'This Week', icon: 'week', count: true },
      { v: { kind: 'upcoming' }, label: 'Upcoming', icon: 'upcoming' },
      { v: { kind: 'anytime' }, label: 'Anytime', icon: 'anytime' },
      { v: { kind: 'someday' }, label: 'Someday', icon: 'someday' },
    ],
    [
      { v: { kind: 'dump' }, label: 'Brain Dump', icon: 'dump', count: true },
      { v: { kind: 'habits' }, label: 'Habits', icon: 'habits' },
      { v: { kind: 'matrix' }, label: 'Matrix', icon: 'matrix' },
      { v: { kind: 'timeblock' }, label: 'Time Blocking', icon: 'timeblock' },
    ],
  ];
  // Pinned under the scrolling lists, just above the footer.
  const bottom: NavItem[] = [
    { v: { kind: 'logbook' }, label: 'Logbook', icon: 'logbook' },
    { v: { kind: 'trash' }, label: 'Trash', icon: 'trash', count: true },
  ];

  const looseProjects = $derived(store.projects.filter((p) => !p.area_id && !p.completed_at));
  const projectsIn = (areaId: string) => store.projects.filter((p) => p.area_id === areaId && !p.completed_at);
</script>

<svelte:window onkeydown={(e) => { if (newListOpen && e.key === 'Escape') { e.stopPropagation(); newListOpen = false; } }} />

{#snippet navRow(item: NavItem)}
  {@const n = item.count ? store.openCount(item.v) : 0}
  <li>
    <button class="row" class:active={store.isView(item.v)} class:drop-ok={dropOn(item.v) === 'ok'} data-drop-view={JSON.stringify(item.v)} onclick={() => store.go(item.v)}>
      <Icon name={item.icon} />
      <span class="label">{item.label}</span>
      {#if n}<span class="count" class:today={item.v.kind === 'today'}>{n}</span>{/if}
    </button>
  </li>
{/snippet}

{#snippet section(items: NavItem[], cls = '')}
  {@const visible = items.filter((item) => viewEnabled(item.v.kind))}
  {#if visible.length}
    <ul class={cls}>
      {#each visible as item}
        {@render navRow(item)}
      {/each}
    </ul>
  {/if}
{/snippet}

<nav class="sidebar" class:open={store.sidebarOpen} class:hidden={store.sidebarHidden} aria-label="Lists">
  <div class="scroll">
    {#each top as items}
      {@render section(items)}
    {/each}

    {#if looseProjects.length || projectDrag.active}
      <!-- While a project is dragged this list shows even when empty, so it can leave its area. -->
      <ul data-project-list="" class:drop-end={projectDropLine(null, null)} class:drop-zone={!looseProjects.length}>
        {#each looseProjects as p (p.id)}
          <li class="has-menu" data-project-id={p.id} class:drop-before={projectDropLine(null, p.id)} class:dragged={projectDrag.id === p.id}>
            <button class="row" class:active={store.isView({ kind: 'project', id: p.id })} class:drop-ok={dropOn({ kind: 'project', id: p.id }) === 'ok'} data-drop-view={JSON.stringify({ kind: 'project', id: p.id })} onclick={() => store.go({ kind: 'project', id: p.id })} oncontextmenu={(e) => menu(e, 'project', p.id)} {@attach projectDraggable(p.id)}>
              <ProgressPie value={store.projectProgress(p.id)} />
              <span class="label">{p.name}</span>
            </button>
            <button class="more" onclick={(e) => menu(e, 'project', p.id)} aria-label={`Actions for ${p.name}`} title="Rename, move, delete">⋯</button>
          </li>
        {:else}
          <li class="drop-hint">No area</li>
        {/each}
      </ul>
    {/if}

    {#each store.areas as a (a.id)}
      {@const projects = projectsIn(a.id)}
      {@const folded = store.collapsedAreas.has(a.id)}
      <ul class="area" data-project-list={a.id} class:drop-end={projectDropLine(a.id, null) && (!projects.length || folded)}>
        <li class="has-menu" data-area-head>
          {#if projects.length}
            <button class="fold" class:folded onclick={(e) => fold(e, a.id)} aria-expanded={!folded} aria-label={`${folded ? 'Expand' : 'Collapse'} ${a.name}`} title={`${folded ? 'Expand' : 'Collapse'} (${isMac ? '⌥' : 'Alt'}-click: all areas)`}>
              <Icon name="chevron" size={14} />
            </button>
          {/if}
          <button class="row area-row" class:active={store.isView({ kind: 'area', id: a.id })} class:drop-ok={dropOn({ kind: 'area', id: a.id }) === 'ok' || (projectDrag.active && projectDrag.slot?.area === a.id)} data-drop-view={JSON.stringify({ kind: 'area', id: a.id })} onclick={() => store.go({ kind: 'area', id: a.id })} oncontextmenu={(e) => menu(e, 'area', a.id)}>
            <Icon name="area" />
            <span class="label">{a.name}</span>
          </button>
          <button class="more" onclick={(e) => menu(e, 'area', a.id)} aria-label={`Actions for ${a.name}`} title="Rename, new project, delete">⋯</button>
        </li>
        {#if projects.length && !folded}
          <li class="projects" in:unfold={{ duration: 220 }} out:unfold={{ duration: 180 }}>
            <ul>
              {#each projects as p (p.id)}
                <li class="has-menu" data-project-id={p.id} class:drop-before={projectDropLine(a.id, p.id)} class:drop-after={projectDropLine(a.id, null) && p === projects[projects.length - 1]} class:dragged={projectDrag.id === p.id}>
                  <button class="row in-area" class:active={store.isView({ kind: 'project', id: p.id })} class:drop-ok={dropOn({ kind: 'project', id: p.id }) === 'ok'} data-drop-view={JSON.stringify({ kind: 'project', id: p.id })} onclick={() => store.go({ kind: 'project', id: p.id })} oncontextmenu={(e) => menu(e, 'project', p.id)} {@attach projectDraggable(p.id)}>
                    <ProgressPie value={store.projectProgress(p.id)} />
                    <span class="label">{p.name}</span>
                  </button>
                  <button class="more" onclick={(e) => menu(e, 'project', p.id)} aria-label={`Actions for ${p.name}`} title="Rename, move, delete">⋯</button>
                </li>
              {/each}
            </ul>
          </li>
        {/if}
      </ul>
    {/each}

  </div>

  {@render section(bottom, 'bottom')}

  <footer>
    <div class="newlist">
      <button class="foot" onclick={() => (newListOpen = !newListOpen)} aria-expanded={newListOpen} aria-haspopup="menu" title="New project or area">
        <Icon name="plus" size={16} /> New List
      </button>
      {#if newListOpen}
        <div class="nl-scrim" onclick={() => (newListOpen = false)} onkeydown={() => {}} role="presentation"></div>
        <div class="nl-menu" role="menu" transition:fly={{ y: 6, duration: 140 }}>
          <button role="menuitem" onclick={() => newList('project')}>
            <ProgressPie value={0} size={18} />
            <span><strong>New Project</strong><small>Something with a finish line, broken into to-dos</small></span>
            <kbd>{keyLabel('mod+shift+n')}</kbd>
          </button>
          <button role="menuitem" onclick={() => newList('area')}>
            <Icon name="area" size={18} />
            <span><strong>New Area</strong><small>An ongoing responsibility, like Home or Health</small></span>
            <kbd>⇧A</kbd>
          </button>
        </div>
      {/if}
    </div>
    <span class="grow"></span>
    <button class="icon-btn" class:on={store.view.kind === 'settings'} onclick={() => store.go({ kind: 'settings' })} title="Settings (Ctrl/⌘ ,)" aria-label="Settings">
      <Icon name="gear" size={16} />
    </button>
    <button class="icon-btn" onclick={() => store.toggleMute()} title="Toggle sounds (⇧M)" aria-label="Toggle sounds">
      <Icon name={store.muted ? 'mute' : 'sound'} size={16} />
    </button>
    <button class="icon-btn" onclick={() => (store.overlay = 'help')} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
      <kbd>?</kbd>
    </button>
  </footer>
</nav>

<style>
  .sidebar {
    width: 248px;
    flex-shrink: 0;
    background: var(--sidebar);
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--line);
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 28px 10px 12px;
  }
  ul {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
  }
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 4px 8px;
    border-radius: 6px;
    text-align: left;
    font-weight: 500;
    font-size: 13.5px;
    transition: background 0.12s;
  }
  .row:hover {
    background: var(--sidebar-hover);
  }
  .row.active {
    background: var(--sidebar-active);
  }
  /* A list that will take the to-dos being dragged. */
  .row.drop-ok {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }
  /* Project drag (#126): a line where the project will land, and the project being moved dimmed. */
  li[data-project-id],
  ul.drop-end > li {
    position: relative;
  }
  li.drop-before::before,
  li.drop-after::after,
  ul.drop-end > li:last-child::after {
    content: '';
    position: absolute;
    left: 8px;
    right: 8px;
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
    pointer-events: none;
  }
  li.drop-before::before {
    top: -1px;
  }
  li.drop-after::after,
  ul.drop-end > li:last-child::after {
    bottom: -1px;
  }
  li.dragged {
    opacity: 0.45;
  }
  ul.drop-zone {
    border: 1.5px dashed var(--line);
    border-radius: 6px;
  }
  ul.drop-zone.drop-end {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .drop-hint {
    position: relative;
    padding: 4px 10px;
    font-size: 12.5px;
    color: var(--text-3);
  }
  .label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    font-size: 12px;
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .count.today {
    color: var(--text-2);
    font-weight: 600;
  }
  .area-row {
    font-weight: 600;
  }
  .area {
    margin-top: 2px;
  }
  ul.bottom {
    margin: 0;
    padding: 6px 10px;
    border-top: 1px solid var(--line);
  }
  /* Area rows leave room on the left for the fold chevron. */
  .row.area-row {
    padding-left: 26px;
  }
  /* Projects inside an area sit a step in, so they read as belonging to it. */
  .row.in-area {
    padding-left: 40px;
  }
  .fold {
    position: absolute;
    left: 2px;
    top: 0;
    bottom: 0;
    z-index: 1;
    width: 22px;
    display: grid;
    place-items: center;
    border-radius: 6px;
  }
  /* The projects under an area, in one block so they open and close together. */
  .projects ul {
    margin: 0;
  }
  .fold :global(svg) {
    transform: rotate(90deg);
    transition: transform 0.2s var(--ease);
  }
  .fold.folded :global(svg) {
    transform: none;
  }
  .fold:hover {
    background: var(--sidebar-active);
  }
  footer {
    display: flex;
    align-items: center;
    gap: 6px;
    /* Same height as the bottom toolbar so the two line up. */
    min-height: 52px;
    padding: 0 10px;
    border-top: 1px solid var(--line);
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
    font-size: 13px;
    padding: 4px 6px;
    border-radius: 6px;
  }
  .foot:hover,
  .icon-btn:hover {
    background: var(--sidebar-hover);
  }
  .icon-btn {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: var(--text-2);
  }
  .grow {
    flex: 1;
  }
  .newlist {
    position: relative;
  }
  .nl-scrim {
    position: fixed;
    inset: 0;
    z-index: 30;
  }
  .nl-menu {
    position: absolute;
    left: 0;
    bottom: calc(100% + 8px);
    z-index: 31;
    width: 270px;
    background: var(--card);
    border-radius: 11px;
    box-shadow: var(--card-shadow), 0 0 0 1px var(--line);
    padding: 6px;
    display: grid;
    gap: 2px;
  }
  .nl-menu button {
    display: flex;
    align-items: center;
    gap: 11px;
    text-align: left;
    padding: 8px 10px;
    border-radius: 8px;
  }
  .nl-menu button:hover,
  .nl-menu button:focus-visible {
    background: var(--select);
    outline: none;
  }
  .nl-menu span {
    flex: 1;
    display: grid;
    gap: 1px;
  }
  .nl-menu strong {
    font-size: 13.5px;
    font-weight: 600;
  }
  .nl-menu small {
    font-size: 11.5px;
    color: var(--text-3);
  }
  .has-menu {
    position: relative;
  }
  .has-menu .row {
    padding-right: 30px;
  }
  .more {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    width: 24px;
    height: 24px;
    border-radius: 6px;
    color: var(--text-2);
    font-size: 15px;
    line-height: 1;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .has-menu:hover .more,
  .more:focus-visible {
    opacity: 1;
  }
  .more:hover {
    background: var(--sidebar-active);
  }
  @media (hover: none) {
    .more {
      opacity: 0.7;
      width: 34px;
      height: 34px;
    }
  }
  .icon-btn.on {
    background: var(--sidebar-active);
  }

  @media (min-width: 761px) {
    .sidebar {
      transition: margin-left 0.22s var(--ease);
    }
    .sidebar.hidden {
      margin-left: -249px;
    }
  }
  @media (max-width: 760px) {
    .sidebar {
      position: fixed;
      top: 0;
      bottom: 0;
      left: 0;
      z-index: 15;
      width: min(300px, 84vw);
      transform: translateX(-102%);
      transition: transform 0.24s var(--ease);
      box-shadow: none;
      padding-left: env(safe-area-inset-left);
      /* The list scrolls below the status bar, not under the clock. */
      padding-top: env(safe-area-inset-top);
    }
    .sidebar.open {
      transform: none;
      box-shadow: 0 0 40px rgba(0, 0, 0, 0.25);
    }
    .scroll {
      padding-top: 16px;
    }
    .row {
      padding: 9px 10px;
      font-size: 15.5px;
      gap: 12px;
    }
    .row.area-row {
      padding-left: 36px;
    }
    .row.in-area {
      padding-left: 52px;
    }
    .fold {
      width: 34px;
    }
    footer {
      padding-bottom: calc(10px + env(safe-area-inset-bottom));
    }
    .icon-btn {
      width: 40px;
      height: 40px;
    }
  }
</style>
