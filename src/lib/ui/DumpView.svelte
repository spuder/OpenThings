<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fade, fly } from 'svelte/transition';
  import { store } from '../store.svelte';
  import { parseQuickAdd } from '../parse';
  import { dumpAgeFraction, DUMP_TTL_MS } from '../views';
  import { prompt } from '../commands';
  import type { Task } from '../types';

  let drafts = $state<Record<string, string>>({});
  const selectedDump = $derived(store.task(store.selectedId)?.dump ? store.task(store.selectedId) : undefined);

  function add(sectionKey: string, sectionName: string | null) {
    const text = (drafts[sectionKey] ?? '').trim();
    if (!text) return;
    const p = parseQuickAdd(text, store.day);
    p.dump = true;
    p.dumpSection = sectionName;
    p.when = null;
    store.addParsed(p, { useContext: false });
    drafts[sectionKey] = '';
  }

  function onKey(e: KeyboardEvent, key: string, name: string | null) {
    if (e.key === 'Enter') add(key, name);
    if (e.key === 'Escape') (e.target as HTMLElement).blur();
  }

  function remaining(t: Task): string {
    const left = DUMP_TTL_MS - (store.now - Date.parse(t.created_at));
    const h = Math.max(0, Math.floor(left / 3_600_000));
    if (h >= 1) return `fades in ${h}h`;
    return `fades in ${Math.max(1, Math.floor(left / 60_000))}m`;
  }

  // Ink fades from 100% to ~28% over the 48 hours.
  const opacity = (t: Task) => (t.completed_at ? 0.55 : 1 - 0.72 * dumpAgeFraction(t, store.now));
  // A slight, stable tilt per item so it reads as handwriting, not a grid.
  const tilt = (id: string) => ((parseInt(id.slice(-4), 16) % 9) - 4) * 0.12;

  function keep(t: Task, where: 'inbox' | 'today') {
    if (where === 'today') {
      store.moveTo(t.id, { inbox: true });
      store.setToday(t.id);
      store.notify('Moved to Today');
    } else {
      store.moveTo(t.id, { inbox: true });
      store.notify('Moved to Inbox');
    }
  }
</script>

<div class="desk">
  <div class="paper" in:fly={{ y: 8, duration: 240 }}>
    <div class="intro">Anything here disappears 48 hours after you write it, unless you check it off or keep it.</div>

    {#each store.groups as g (g.key)}
      <section>
        {#if g.title}
          <div class="section-head">
            <h3>{g.title}</h3>
            {#if g.sectionId}
              <button
                class="delete-section"
                onclick={() => store.deleteDumpSection(g.sectionId!)}
                aria-label={`Remove ${g.title} section`}
                title="Remove section"
              >×</button>
            {/if}
          </div>
        {/if}
        <ul>
          {#each g.items as t (t.id)}
            <li
              class:selected={store.selectedId === t.id}
              class:done={!!t.completed_at}
              style:opacity={opacity(t)}
              style:transform={`rotate(${tilt(t.id)}deg)`}
              animate:flip={{ duration: 220 }}
              in:fade={{ duration: 200 }}
              out:fade={{ duration: 400 }}
              onclick={() => (store.selectedId = t.id)}
              onkeydown={() => {}}
              role="option"
              aria-selected={store.selectedId === t.id}
            >
              <button class="mark" onclick={(e) => { e.stopPropagation(); store.toggleComplete(t.id); }} aria-label="Check off">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path class="ring" d="M12 3.5c4.8-.2 8.6 3.4 8.4 8.3-.2 4.7-3.9 8.4-8.6 8.2-4.6-.2-8.2-3.9-8-8.4.2-4.4 3.6-7.9 8.4-8.3" />
                  <path class="tick" d="M7.5 12.5l3 3.2 6.5-7.5" />
                </svg>
              </button>
              <span class="text">
                {t.title}
                <svg class="strike" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M1 6 C 20 3, 40 8, 60 5 S 90 4, 99 6" />
                </svg>
              </span>
              {#if store.selectedId === t.id && !t.completed_at}
                <span class="actions" in:fade={{ duration: 120 }}>
                  <span class="ttl">{remaining(t)}</span>
                  <button onclick={(e) => { e.stopPropagation(); keep(t, 'today'); }} title="Keep in Today">Today</button>
                  <button onclick={(e) => { e.stopPropagation(); keep(t, 'inbox'); }} title="Keep in Inbox (⇧I)">Inbox</button>
                  <button onclick={(e) => { e.stopPropagation(); store.paletteMode = { kind: 'move' }; store.overlay = 'palette'; }} title="Move to a list (M)">Move…</button>
                </span>
              {/if}
            </li>
          {/each}
          <li class="write">
            <input
              placeholder={g.title ? `add to ${g.title.toLowerCase()}…` : 'write anything…'}
              bind:value={drafts[g.key]}
              onkeydown={(e) => onKey(e, g.key, g.title ?? null)}
              aria-label={`Add to ${g.title ?? 'brain dump'}`}
            />
          </li>
        </ul>
      </section>
    {/each}

    <button class="new-section" onclick={() => prompt('New section', (name) => store.addDumpSection(name))}>+ new section</button>
  </div>

  {#if selectedDump && !selectedDump.completed_at}
    <div class="mobile-bar" transition:fly={{ y: 16, duration: 160 }}>
      <span class="ttl">{remaining(selectedDump)}</span>
      <button onclick={() => keep(selectedDump!, 'today')}>Today</button>
      <button onclick={() => keep(selectedDump!, 'inbox')}>Inbox</button>
      <button onclick={() => { store.paletteMode = { kind: 'move' }; store.overlay = 'palette'; }}>Move…</button>
    </div>
  {/if}
</div>

<style>
  .desk {
    padding: 4px 0 40px;
  }
  .paper {
    --line-h: 34px;
    position: relative;
    background-color: var(--paper);
    background-image:
      linear-gradient(90deg, transparent 54px, var(--paper-margin) 54px, var(--paper-margin) 55.5px, transparent 55.5px),
      repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--line-h) - 1px), var(--paper-line) calc(var(--line-h) - 1px), var(--paper-line) var(--line-h));
    background-position: 0 0, 0 22px;
    border-radius: 3px;
    box-shadow: var(--paper-shadow);
    padding: 22px 28px 30px 70px;
    font-family: 'Caveat', 'Bradley Hand', cursive;
    color: var(--paper-ink);
    min-height: 70vh;
  }
  .paper::before {
    /* Subtle paper grain. */
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: inherit;
    opacity: 0.35;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.45 0 0 0 0 0.38 0 0 0 0 0.25 0 0 0 0.09 0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  .intro {
    font-size: 18px;
    line-height: var(--line-h);
    padding-top: 6px;
    height: var(--line-h);
    opacity: 0.55;
    margin-bottom: var(--line-h);
  }
  .section-head {
    display: flex;
    align-items: center;
    height: var(--line-h);
  }
  h3 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 27px;
    font-weight: 600;
    line-height: 1;
    height: var(--line-h);
    display: flex;
    align-items: flex-end;
    padding-bottom: 4px;
    text-decoration: underline wavy color-mix(in srgb, var(--paper-ink) 35%, transparent);
    text-underline-offset: 5px;
    text-decoration-thickness: 1px;
  }
  .delete-section {
    flex: none;
    width: 44px;
    height: 44px;
    /* A 44px touch target in a 34px row, without pushing the ruled lines apart. */
    margin-block: calc((var(--line-h) - 44px) / 2);
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 22px;
    line-height: 1;
    color: inherit;
    opacity: 0.35;
  }
  .delete-section:hover,
  .delete-section:focus-visible {
    opacity: 0.85;
  }
  section {
    margin-bottom: var(--line-h);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: flex-end;
    padding-bottom: 3px;
    gap: 10px;
    height: var(--line-h);
    font-size: 24px;
    line-height: var(--line-h);
    border-radius: 4px;
    margin-left: -8px;
    padding-left: 8px;
    transform-origin: left center;
    transition: opacity 1.5s linear, background 0.12s;
  }
  li.selected {
    background: color-mix(in srgb, var(--paper-ink) 7%, transparent);
  }
  .mark {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    margin-bottom: 2px;
    color: var(--paper-ink);
  }
  .mark svg {
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .ring {
    opacity: 0.55;
  }
  .tick {
    stroke-width: 2.4;
    stroke-dasharray: 20;
    stroke-dashoffset: 20;
    transition: stroke-dashoffset 0.35s ease-out;
  }
  .done .tick {
    stroke-dashoffset: 0;
  }
  .text {
    position: relative;
    line-height: 1.1;
    white-space: nowrap;
    overflow: visible;
  }
  .strike {
    position: absolute;
    left: -3px;
    right: -3px;
    top: 50%;
    width: calc(100% + 6px);
    height: 10px;
    transform: translateY(-40%);
    fill: none;
    stroke: var(--paper-ink);
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-dasharray: 120;
    stroke-dashoffset: 120;
    transition: stroke-dashoffset 0.45s ease-out;
    pointer-events: none;
  }
  .done .strike {
    stroke-dashoffset: 0;
  }
  .actions {
    align-self: center;
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 4px;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 12px;
  }
  .ttl {
    color: color-mix(in srgb, var(--paper-ink) 60%, transparent);
    margin-right: 6px;
    font-style: italic;
  }
  .actions button {
    border: 1px solid color-mix(in srgb, var(--paper-ink) 25%, transparent);
    border-radius: 12px;
    padding: 0 9px;
    line-height: 20px;
    color: var(--paper-ink);
  }
  .actions button:hover {
    background: color-mix(in srgb, var(--paper-ink) 10%, transparent);
  }
  .write input {
    flex: 1;
    line-height: 1.1;
    border: none;
    outline: none;
    background: transparent;
    font: inherit;
    color: inherit;
    padding-left: 32px;
  }
  .write input::placeholder {
    color: var(--paper-ink);
    opacity: 0.3;
  }
  .new-section {
    font-family: inherit;
    font-size: 22px;
    color: var(--paper-ink);
    opacity: 0.45;
    line-height: 1;
    height: var(--line-h);
    padding-top: 10px;
  }
  .new-section:hover {
    opacity: 0.8;
  }
  @media (max-width: 760px) {
    .paper {
      padding: 14px 12px 24px 44px;
      background-image:
        linear-gradient(90deg, transparent 32px, var(--paper-margin) 32px, var(--paper-margin) 33.5px, transparent 33.5px),
        repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--line-h) - 1px), var(--paper-line) calc(var(--line-h) - 1px), var(--paper-line) var(--line-h));
      background-position: 0 0, 0 14px;
      min-height: 60vh;
    }
    .intro {
      font-size: 16px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    li {
      font-size: 22px;
    }
    .text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .actions {
      display: none;
    }
    .write input {
      padding-left: 30px;
      font-size: 22px;
    }
  }
  .mobile-bar {
    display: none;
  }
  @media (max-width: 760px) {
    .mobile-bar {
      position: fixed;
      left: 50%;
      transform: translateX(-50%);
      bottom: calc(90px + env(safe-area-inset-bottom));
      z-index: 5;
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--card);
      box-shadow: var(--card-shadow);
      border-radius: 14px;
      padding: 6px 8px 6px 12px;
      white-space: nowrap;
      font-size: 14px;
    }
    .mobile-bar .ttl {
      font-size: 12px;
      color: var(--text-3);
      margin-right: 2px;
    }
    .mobile-bar button {
      padding: 0 12px;
      line-height: 34px;
      border-radius: 9px;
      color: var(--accent);
      font-weight: 500;
    }
    .mobile-bar button:active {
      background: var(--chip);
    }
  }
</style>
