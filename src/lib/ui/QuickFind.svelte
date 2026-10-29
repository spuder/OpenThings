<script lang="ts">
  import { scale } from 'svelte/transition';
  import { store } from '../store.svelte';
  import { relLabel } from '../dates';
  import type { Task, ViewKey } from '../types';
  import Icon from './Icon.svelte';
  import ProgressPie from './ProgressPie.svelte';
  import { viewEnabled } from '../features.svelte';

  interface Result {
    key: string;
    group: 'Recent' | 'Lists' | 'Tags' | 'To-dos';
    label: string;
    sub?: string;
    icon?: string;
    project?: string;
    tag?: boolean;
    task?: Task;
    count?: number;
    run: () => void;
  }

  let q = $state('');
  let index = $state(0);
  let input: HTMLInputElement | undefined = $state();
  let listEl: HTMLElement | undefined = $state();

  $effect(() => {
    input?.focus();
  });

  const builtins: { v: ViewKey; label: string; icon: string }[] = [
    { v: { kind: 'inbox' }, label: 'Inbox', icon: 'inbox' },
    { v: { kind: 'today' }, label: 'Today', icon: 'today' },
    { v: { kind: 'week' }, label: 'This Week', icon: 'week' },
    { v: { kind: 'upcoming' }, label: 'Upcoming', icon: 'upcoming' },
    { v: { kind: 'anytime' }, label: 'Anytime', icon: 'anytime' },
    { v: { kind: 'someday' }, label: 'Someday', icon: 'someday' },
    { v: { kind: 'logbook' }, label: 'Logbook', icon: 'logbook' },
    { v: { kind: 'trash' }, label: 'Trash', icon: 'trash' },
    { v: { kind: 'dump' }, label: 'Brain Dump', icon: 'dump' },
    { v: { kind: 'habits' }, label: 'Habits', icon: 'habits' },
    { v: { kind: 'matrix' }, label: 'Matrix', icon: 'matrix' },
    { v: { kind: 'settings' }, label: 'Settings', icon: 'settings' },
  ];

  function viewResult(v: ViewKey, group: Result['group']): Result | null {
    if (!viewEnabled(v.kind)) return null;
    const go = () => store.go(v);
    const count = store.openCount(v) || undefined;
    const b = builtins.find((x) => x.v.kind === v.kind);
    if (b) return { key: `v-${v.kind}`, group, label: b.label, icon: b.icon, count, run: go };
    if (v.kind === 'area') {
      const a = store.areas.find((x) => x.id === v.id);
      return a ? { key: `a-${a.id}`, group, label: a.name, icon: 'area', count, run: go } : null;
    }
    if (v.kind === 'project') {
      const p = store.projects.find((x) => x.id === v.id);
      if (!p) return null;
      const area = store.areas.find((a) => a.id === p.area_id)?.name;
      return { key: `p-${p.id}`, group, label: p.name, sub: area, project: p.id, count, run: go };
    }
    if (v.kind === 'tag') {
      const t = store.tags.find((x) => x.id === v.id);
      return t ? { key: `t-${t.id}`, group, label: t.name, tag: true, count, run: go } : null;
    }
    return null;
  }

  /** Lower is better: exact, then prefix, then word-prefix, then substring. -1 = no match. */
  function rank(text: string, query: string): number {
    const t = text.toLowerCase();
    if (t === query) return 0;
    if (t.startsWith(query)) return 1;
    if (t.split(/[\s\-_/]+/).some((w) => w.startsWith(query))) return 2;
    return t.includes(query) ? 3 : -1;
  }

  const results: Result[] = $derived.by(() => {
    const query = q.trim().toLowerCase();
    if (!query) {
      return store.recentViews.map((v) => viewResult(v, 'Recent')).filter((r): r is Result => !!r);
    }
    const tagQuery = query.startsWith('#') ? query.slice(1) : null;
    const out: Result[] = [];

    if (tagQuery === null) {
      const lists: [number, Result][] = [];
      const views: ViewKey[] = [
        ...builtins.map((b) => b.v),
        ...store.areas.map((a) => ({ kind: 'area' as const, id: a.id })),
        ...store.projects.filter((p) => !p.completed_at).map((p) => ({ kind: 'project' as const, id: p.id })),
      ];
      for (const v of views) {
        const r = viewResult(v, 'Lists');
        if (!r) continue;
        const score = rank(r.label, query);
        if (score >= 0) lists.push([score, r]);
      }
      out.push(...lists.sort((a, b) => a[0] - b[0]).slice(0, 8).map(([, r]) => r));
    }

    const tq = tagQuery ?? query;
    for (const t of store.tags) {
      if (tq === '' || rank(t.name, tq) >= 0) {
        const r = viewResult({ kind: 'tag', id: t.id }, 'Tags');
        if (r) out.push(r);
      }
    }

    if (tagQuery === null) {
      const tasks = store.tasks
        .map((t) => ({ t, s: Math.min(...[rank(t.title, query), t.notes.toLowerCase().includes(query) ? 4 : -1].filter((x) => x >= 0).concat([99])) }))
        .filter((x) => x.s < 99)
        // Open to-dos first, then by match quality.
        .sort((a, b) => Number(!!a.t.completed_at) - Number(!!b.t.completed_at) || a.s - b.s)
        .slice(0, 25);
      for (const { t } of tasks) {
        out.push({
          key: `task-${t.id}`,
          group: 'To-dos',
          label: t.title,
          sub: [store.containerName(t), t.when_date ? relLabel(t.when_date, store.day) : t.someday ? 'Someday' : null, t.completed_at ? 'Done' : null]
            .filter(Boolean)
            .join(' · '),
          task: t,
          run: () => store.reveal(t.id),
        });
      }
    }
    return out;
  });

  $effect(() => {
    void results.length;
    index = 0;
  });

  $effect(() => {
    listEl?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  });

  function close() {
    (document.activeElement as HTMLElement | null)?.blur();
    store.overlay = null;
  }

  function choose(i: number) {
    const r = results[i];
    if (!r) return;
    close();
    r.run();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault();
      index = Math.min(results.length - 1, index + 1);
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault();
      index = Math.max(0, index - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(index);
    }
  }

  const isCurrent = (r: Result) => r.group === 'Recent' && r.key === results[0]?.key && store.recentViews.length > 0 && JSON.stringify(store.recentViews[0]) === JSON.stringify(store.view);
</script>

<div class="scrim" onclick={close} onkeydown={() => {}} role="presentation"></div>
<div class="panel" in:scale={{ start: 0.96, duration: 150, opacity: 1 }} role="dialog" aria-modal="true" aria-label="Quick Find">
  <div class="search">
    <Icon name="search" size={18} />
    <input bind:this={input} bind:value={q} onkeydown={onKey} placeholder="Quick Find" spellcheck="false" autocomplete="off" aria-label="Quick Find" />
  </div>

  <div class="results" bind:this={listEl} role="listbox">
    {#each results as r, i (r.key)}
      {#if i === 0 || results[i - 1].group !== r.group}
        <div class="group">{r.group}</div>
      {/if}
      <button class="item" class:active={i === index} data-i={i} role="option" aria-selected={i === index} onmouseenter={() => (index = i)} onclick={() => choose(i)}>
        <span class="icon">
          {#if r.icon}<Icon name={r.icon} size={18} />
          {:else if r.project}<ProgressPie value={store.projectProgress(r.project)} size={18} />
          {:else if r.tag}<span class="hash">#</span>
          {:else if r.task}<span class="box" class:done={!!r.task.completed_at}></span>{/if}
        </span>
        <span class="text">
          <span class="label">{r.label}</span>
          {#if r.sub}<span class="sub">{r.sub}</span>{/if}
        </span>
        {#if isCurrent(r)}<span class="check" aria-label="current list">✓</span>{/if}
        {#if r.count}<span class="count">{r.count}</span>{/if}
      </button>
    {/each}

    {#if !results.length}
      <p class="hint">
        {#if q.trim()}No matches for “{q.trim()}”.{:else}Jump to any list, find to-dos by title or notes, or type # to search tags.{/if}
      </p>
    {:else if !q.trim()}
      <p class="hint">Jump to any list, find to-dos, or type # to search tags.</p>
    {/if}
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.22);
    z-index: 20;
  }
  .panel {
    position: fixed;
    top: 12vh;
    left: 50%;
    translate: -50% 0;
    width: min(440px, calc(100vw - 16px));
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    z-index: 21;
    background: var(--card);
    border-radius: 16px;
    box-shadow: var(--card-shadow), 0 0 0 1px var(--line);
    overflow: hidden;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 12px 12px 6px;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--chip);
    color: var(--text-3);
  }
  .search :global(svg) {
    stroke: var(--text-3);
  }
  input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 17px;
  }
  .results {
    overflow-y: auto;
    padding: 2px 8px 10px;
  }
  .group {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-3);
    padding: 10px 8px 6px;
    margin: 0 4px 4px;
    border-bottom: 1px solid var(--line);
  }
  .item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-radius: 9px;
    text-align: left;
  }
  .item.active {
    background: var(--select);
  }
  .icon {
    width: 20px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .hash {
    font-weight: 700;
    color: var(--text-2);
  }
  .box {
    width: 14px;
    height: 14px;
    border-radius: 4px;
    border: 1.5px solid var(--line-strong);
  }
  .box.done {
    background: var(--accent);
    border-color: var(--accent);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: grid;
  }
  .label {
    font-weight: 600;
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: 12px;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    font-size: 13px;
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .check {
    color: var(--accent);
    font-weight: 700;
  }
  .hint {
    text-align: center;
    color: var(--text-3);
    font-size: 13.5px;
    margin: 14px 24px 8px;
  }
  @media (max-width: 760px) {
    .panel {
      top: calc(8px + env(safe-area-inset-top));
    }
    input {
      font-size: 16px;
    }
  }
</style>
