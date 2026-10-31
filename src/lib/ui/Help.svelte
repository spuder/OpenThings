<script lang="ts">
  import { store } from '../store.svelte';
  import { commands, keyLabel, type Command } from '../commands';

  const order: Command['group'][] = ['Navigate', 'Create', 'Selection', 'Task', 'Brain dump', 'Habits', 'Calendar', 'Trash', 'Time', 'App'];
  const extra: Partial<Record<Command['group'], [string, string][]>> = {
    Selection: [
      ['Next / previous', 'J / K'],
      ['First / last', 'G G / ⇧G'],
      ['Close / deselect', 'Esc'],
      ['Extend selection', '⇧↑ / ⇧↓'],
      ['Select a range / one more', `⇧ click / ${keyLabel('mod')} click`],
      ['Pick / unpick (selection mode)', 'Space'],
    ],
    App: [['Command palette', keyLabel('mod+k')]],
  };

  const syntax: [string, string][] = [
    ['#tag', 'Add a tag'],
    ['+Project', 'Put in a project or area (hyphens for spaces)'],
    ['@today @tonight @tomorrow', 'When'],
    ['@fri @in3d @2w @nov-3', 'When, by weekday, offset or date'],
    ['@someday @inbox', 'Someday or Inbox'],
    ['@dump  @dump/Ideas', 'Brain dump, optional section'],
    ['!fri', 'Deadline'],
    ['%9am %in30m %fri-9am', 'Reminder'],
    ['~30m  ~1h30m', 'Time estimate'],
    ['*daily *weekly *weekdays *2w', 'Repeat'],
    ['*mon,thu *2w-mon,thu', 'Repeat on days of the week'],
    ['*1st,15th *last-day', 'Repeat on days of the month'],
    ['*2nd-tue *last-fri', 'Repeat on a weekday of the month'],
    ['^u ^i ^ui', 'Urgent / important'],
    ['… // notes', 'Notes after //'],
  ];

  function close() {
    store.overlay = null;
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); close(); } }} />

<div class="scrim" onclick={close} onkeydown={() => {}} role="presentation"></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
  <h1>Keyboard shortcuts</h1>
  <div class="cols">
    {#each order as group}
      {@const list = commands.filter((c) => c.group === group && !c.hidden && c.keys.length)}
      {#if list.length || extra[group]}
        <section>
          <h2>{group}</h2>
          {#each extra[group] ?? [] as [title, k]}
            <div class="row"><span>{title}</span><kbd>{k}</kbd></div>
          {/each}
          {#each list as c (c.id)}
            <div class="row">
              <span>{c.title}</span>
              <span class="keys">{#each c.keys.slice(0, 2) as k}<kbd>{keyLabel(k)}</kbd>{/each}</span>
            </div>
          {/each}
        </section>
      {/if}
    {/each}
    <section class="syntax">
      <h2>Quick add syntax</h2>
      {#each syntax as [s, d]}
        <div class="row"><code>{s}</code><span class="d">{d}</span></div>
      {/each}
    </section>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.25);
    z-index: 20;
  }
  .sheet {
    position: fixed;
    inset: 6vh 6vw;
    background: var(--card);
    border-radius: 14px;
    box-shadow: var(--card-shadow);
    z-index: 21;
    padding: 26px 32px;
    overflow-y: auto;
  }
  h1 {
    margin: 0 0 18px;
    font-size: 20px;
  }
  @media (max-width: 760px) {
    .sheet {
      inset: calc(8px + env(safe-area-inset-top)) 8px calc(8px + env(safe-area-inset-bottom));
      padding: 18px 18px;
    }
  }
  .cols {
    columns: 3 280px;
    column-gap: 36px;
  }
  section {
    break-inside: avoid;
    margin-bottom: 22px;
  }
  h2 {
    font-size: 11.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-3);
    margin: 0 0 6px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 3px 0;
    font-size: 13px;
  }
  .keys {
    display: flex;
    gap: 4px;
  }
  code {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 12px;
    color: var(--accent);
  }
  .d {
    color: var(--text-2);
    text-align: right;
  }
</style>
