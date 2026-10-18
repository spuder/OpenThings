<script lang="ts">
  import { sync } from '../sync/engine.svelte';
  import { PROTOCOL_VERSION } from '../sync/protocol';
  import { store } from '../store.svelte';
  import SyncBadge from './SyncBadge.svelte';

  let url = $state(sync.serverUrl ?? '');
  let testing = $state(false);
  let testResult = $state<{ ok: boolean; text: string } | null>(null);

  async function test() {
    testing = true;
    testResult = null;
    try {
      const h = await sync.test(url);
      testResult = { ok: true, text: `Connected: OpenThings server${h.version ? ' ' + h.version : ''}, protocol ${h.protocol}` };
    } catch (e) {
      testResult = { ok: false, text: (e as Error).message };
    } finally {
      testing = false;
    }
  }

  function save(enable: boolean) {
    sync.configure(url || null, enable);
    url = sync.serverUrl ?? '';
  }

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'Never');
</script>

<div class="settings">
  <section>
    <header>
      <h2>Sync</h2>
      <SyncBadge />
    </header>
    <p class="lead">
      Sync sends this device's changes to your OpenThings server and pulls changes from your other devices. Without it, data stays in this browser.
    </p>

    <label class="field">
      <span>Server URL</span>
      <input
        bind:value={url}
        placeholder="https://openthings.your-tailnet.ts.net"
        inputmode="url"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
        onkeydown={(e) => e.key === 'Enter' && test()}
      />
    </label>
    <div class="row-actions">
      <button class="btn" onclick={() => (url = location.origin)}>Use this site</button>
      <button class="btn" onclick={test} disabled={!url || testing}>{testing ? 'Testing…' : 'Test connection'}</button>
      {#if sync.enabled}
        <button class="btn" onclick={() => save(true)} disabled={!url || url === sync.serverUrl}>Save URL</button>
        <button class="btn danger" onclick={() => save(false)}>Turn off sync</button>
      {:else}
        <button class="btn primary" onclick={() => save(true)} disabled={!url}>Turn on sync</button>
      {/if}
    </div>
    {#if testResult}
      <p class="result" class:ok={testResult.ok}>{testResult.text}</p>
    {/if}

    <dl>
      <dt>Status</dt>
      <dd>{sync.status}{#if sync.error}{' — '}{sync.error}{/if}</dd>
      <dt>Last sync</dt>
      <dd>{fmt(sync.lastSyncedAt)}</dd>
      <dt>Waiting to sync</dt>
      <dd>{sync.pending} changes</dd>
      <dt>This device</dt>
      <dd><code>{sync.device}</code></dd>
      <dt>Protocol</dt>
      <dd>v{PROTOCOL_VERSION} (draft)</dd>
    </dl>
    <button class="btn" onclick={() => sync.kick()} disabled={!sync.enabled || sync.status === 'syncing'}>Sync now</button>
    <p class="note">The sync server isn't released yet. Until it is, turning sync on will show “Can't reach the server”, and your changes keep waiting safely on this device.</p>
  </section>

  <section>
    <h2>Sounds</h2>
    <label class="toggle">
      <input type="checkbox" checked={!store.muted} onchange={() => store.toggleMute()} />
      <span>Play sounds when completing to-dos and habits</span>
    </label>
  </section>

  <section>
    <h2>Data</h2>
    <div class="row-actions">
      <button class="btn" onclick={() => store.exportJson()}>Export JSON backup</button>
      <button class="btn danger" onclick={() => confirm('Erase all local data and restore the demo?') && store.resetDemo()}>Reset to demo data</button>
    </div>
  </section>
</div>

<style>
  .settings {
    max-width: 620px;
  }
  section {
    padding: 4px 0 26px;
    margin-bottom: 22px;
    border-bottom: 1px solid var(--line);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  h2 {
    font-size: 16px;
    margin: 0 0 8px;
  }
  .lead,
  .note {
    color: var(--text-2);
    font-size: 13.5px;
    margin: 4px 0 16px;
  }
  .note {
    font-size: 12.5px;
    color: var(--text-3);
    margin-top: 14px;
  }
  .field {
    display: grid;
    gap: 6px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-2);
  }
  .field input {
    font-size: 15px;
    font-weight: 400;
    color: var(--text);
    padding: 9px 11px;
    border: 1px solid var(--line-strong);
    border-radius: 8px;
    background: var(--bg);
    outline: none;
  }
  .field input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }
  .btn {
    font-size: 13px;
    font-weight: 500;
    padding: 7px 12px;
    border-radius: 8px;
    border: 1px solid var(--line-strong);
  }
  .btn:hover:not(:disabled) {
    background: var(--chip);
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  .btn.primary:hover:not(:disabled) {
    background: var(--accent);
    filter: brightness(1.08);
  }
  .btn.danger {
    color: var(--deadline);
  }
  .result {
    font-size: 13px;
    color: var(--deadline);
    margin: 10px 0 0;
  }
  .result.ok {
    color: var(--logbook);
  }
  dl {
    display: grid;
    grid-template-columns: 130px 1fr;
    gap: 6px 12px;
    font-size: 13px;
    margin: 18px 0 14px;
  }
  dt {
    color: var(--text-3);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  code {
    font-size: 12px;
  }
  .toggle {
    display: flex;
    gap: 10px;
    align-items: center;
    font-size: 14px;
  }
  .toggle input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
  @media (max-width: 760px) {
    .field input {
      font-size: 16px;
    }
    .btn {
      padding: 10px 14px;
    }
    dl {
      grid-template-columns: 110px 1fr;
    }
  }
</style>
