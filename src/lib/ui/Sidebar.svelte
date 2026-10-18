<script lang="ts">
  import { store } from '../store.svelte';
  import type { ViewKey } from '../types';
  import Icon from './Icon.svelte';
  import ProgressPie from './ProgressPie.svelte';
  import { prompt } from '../commands';

  const top: { v: ViewKey; label: string; icon: string; count?: boolean }[][] = [
    [{ v: { kind: 'inbox' }, label: 'Inbox', icon: 'inbox', count: true }],
    [
      { v: { kind: 'today' }, label: 'Today', icon: 'today', count: true },
      { v: { kind: 'upcoming' }, label: 'Upcoming', icon: 'upcoming' },
      { v: { kind: 'anytime' }, label: 'Anytime', icon: 'anytime' },
      { v: { kind: 'someday' }, label: 'Someday', icon: 'someday' },
    ],
    [{ v: { kind: 'logbook' }, label: 'Logbook', icon: 'logbook' }],
    [
      { v: { kind: 'dump' }, label: 'Brain Dump', icon: 'dump', count: true },
      { v: { kind: 'habits' }, label: 'Habits', icon: 'habits' },
      { v: { kind: 'matrix' }, label: 'Matrix', icon: 'matrix' },
    ],
  ];

  const looseProjects = $derived(store.projects.filter((p) => !p.area_id && !p.completed_at));
  const projectsIn = (areaId: string) => store.projects.filter((p) => p.area_id === areaId && !p.completed_at);
</script>

<nav class="sidebar" aria-label="Lists">
  <div class="scroll">
    {#each top as section}
      <ul>
        {#each section as item}
          {@const n = item.count ? store.openCount(item.v) : 0}
          <li>
            <button class="row" class:active={store.isView(item.v)} onclick={() => store.go(item.v)}>
              <Icon name={item.icon} />
              <span class="label">{item.label}</span>
              {#if n}<span class="count" class:today={item.v.kind === 'today'}>{n}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/each}

    {#if looseProjects.length}
      <ul>
        {#each looseProjects as p (p.id)}
          <li>
            <button class="row" class:active={store.isView({ kind: 'project', id: p.id })} onclick={() => store.go({ kind: 'project', id: p.id })}>
              <ProgressPie value={store.projectProgress(p.id)} />
              <span class="label">{p.name}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#each store.areas as a (a.id)}
      <ul class="area">
        <li>
          <button class="row area-row" class:active={store.isView({ kind: 'area', id: a.id })} onclick={() => store.go({ kind: 'area', id: a.id })}>
            <Icon name="area" />
            <span class="label">{a.name}</span>
          </button>
        </li>
        {#each projectsIn(a.id) as p (p.id)}
          <li>
            <button class="row" class:active={store.isView({ kind: 'project', id: p.id })} onclick={() => store.go({ kind: 'project', id: p.id })}>
              <ProgressPie value={store.projectProgress(p.id)} />
              <span class="label">{p.name}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/each}
  </div>

  <footer>
    <button class="foot" onclick={() => prompt('New project', (name) => store.go({ kind: 'project', id: store.addProject(name) }))} title="New project (⇧N)">
      <Icon name="plus" size={16} /> New List
    </button>
    <span class="grow"></span>
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
    margin: 0 0 18px;
    padding: 0;
  }
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 5px 8px;
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
    margin-top: 6px;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px 10px;
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
</style>
