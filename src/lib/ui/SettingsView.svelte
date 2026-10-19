<script lang="ts">
  import { sync } from '../sync/engine.svelte';
  import { PROTOCOL_VERSION } from '../sync/protocol';
  import { store } from '../store.svelte';
  import SyncBadge from './SyncBadge.svelte';
  import CodeBlock from './CodeBlock.svelte';
  import { notifier, upcomingReminders } from '../reminders.svelte';
  import { reminderLabel } from '../parse';
  import { theme, type ThemePref } from '../theme.svelte';
  import { isNativeShell } from '../native/shell';
  import { nativeStatus } from '../native/status.svelte';
  import { MAX_SCHEDULED } from '../native/snapshot';
  import { isTouch } from '../env';
  import { FEATURES, features } from '../features.svelte';
  const native = isNativeShell();
  const themes: [ThemePref, string][] = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];

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

  /** Where the REST API and MCP endpoint live: the sync server, or this site if it serves the app. */
  const base = $derived(sync.serverUrl ?? (typeof location !== 'undefined' && !native ? location.origin : 'https://openthings.your-tailnet.ts.net'));
  const upcoming = $derived(upcomingReminders(store.tasks, store.now));
  const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad/.test(navigator.userAgent);
  const standalone = typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches;

  let testMsg = $state<{ ok: boolean; text: string } | null>(null);
  let countdown = $state(0);

  async function testNotification(delaySec = 0) {
    if (notifier.permission === 'default') await notifier.request();
    testMsg = null;
    if (delaySec) {
      countdown = delaySec;
      const iv = setInterval(() => (countdown = Math.max(0, countdown - 1)), 1000);
      await new Promise((r) => setTimeout(r, delaySec * 1000));
      clearInterval(iv);
      countdown = 0;
    }
    const ok = await notifier.show('OpenThings', 'Notifications are working.');
    testMsg = ok
      ? { ok: true, text: 'Sent. If nothing appeared, check Focus / Do Not Disturb and the app’s notification settings on your device.' }
      : { ok: false, text: `Couldn't show it: ${notifier.lastError ?? 'unknown error'}` };
  }

  const permissionText: Record<string, string> = {
    granted: 'Allowed',
    default: 'Not asked yet',
    denied: 'Blocked — allow them in your browser or system settings',
    unsupported: 'Not supported in this browser',
  };

  const mcpHttp = $derived(JSON.stringify({ mcpServers: { openthings: { type: 'http', url: `${base}/mcp` } } }, null, 2));
  const mcpStdio = $derived(JSON.stringify({ mcpServers: { openthings: { command: 'npx', args: ['-y', 'mcp-remote', `${base}/mcp`] } } }, null, 2));
  const mcpCli = $derived(`claude mcp add --transport http openthings ${base}/mcp`);
  const curl = $derived(`# Add a to-do with quick-add syntax
curl -X POST ${base}/api/v1/tasks \\
  -H 'content-type: application/json' \\
  -d '{"text": "Call dentist +Health @fri %9am #phone"}'

# List Today
curl '${base}/api/v1/tasks?view=today'`);

  const endpoints: [string, string, string][] = [
    ['GET', '/api/v1/tasks?view=today', 'List a view: inbox, today, week, upcoming, anytime, someday, logbook, dump, trash, matrix'],
    ['GET', '/api/v1/tasks?q=…', 'Search titles and notes'],
    ['POST', '/api/v1/tasks', 'Create from quick-add text {"text": "…"} or fields'],
    ['PATCH', '/api/v1/tasks/:id', 'Update fields (title, when, deadline, reminder, tags…)'],
    ['POST', '/api/v1/tasks/:id/complete', 'Complete (or /uncomplete, /move, /restore)'],
    ['DELETE', '/api/v1/tasks/:id', 'Move to Trash'],
    ['GET · POST', '/api/v1/projects · /areas · /tags', 'Lists and structure'],
    ['GET · POST', '/api/v1/habits · /habits/:id/check', 'Habits and check-ins'],
    ['GET · POST', '/api/v1/timers · /start · /stop', 'Time tracking'],
  ];

  const tools: [string, string][] = [
    ['list_tasks', 'Read a list (Today, Inbox, a project, a tag…)'],
    ['search_tasks', 'Find to-dos by words in the title or notes'],
    ['get_task', 'One to-do with notes, tags and checklist'],
    ['add_task', 'Create a to-do using quick-add syntax'],
    ['update_task', 'Change title, notes, dates, tags, reminder'],
    ['complete_task', 'Check off a to-do (or undo)'],
    ['move_task', 'Move to a project, area, the Inbox or the Brain Dump'],
    ['delete_task', 'Move to the Trash (or restore)'],
    ['brain_dump', 'Capture something into the Brain Dump'],
    ['add_checklist_item / check_checklist_item', 'Checklists'],
    ['list_projects / add_project', 'Areas, projects and tags'],
    ['list_habits / check_habit', 'Habits and check-ins'],
    ['start_timer / stop_timer / current_timer', 'Time tracking'],
  ];

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
      {#if !native}<button class="btn" onclick={() => (url = location.origin)}>Use this site</button>{/if}
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
    <p class="note">The server is the OpenThings Docker image. Each device keeps a full copy and works offline; changes wait here until the server is reachable.</p>
  </section>

  <section>
    <header>
      <h2>Notifications</h2>
      <span class="pill" class:ok={notifier.permission === 'granted'}>{permissionText[notifier.permission]}</span>
    </header>
    <p class="lead">
      Reminders (press <kbd>A</kbd> on a to-do, or type <code>%9am</code> in quick add) show a system notification, play a chime, and appear in the app.
    </p>
    <div class="row-actions">
      {#if notifier.permission === 'default'}
        <button class="btn primary" onclick={() => notifier.request()}>Allow notifications</button>
      {/if}
      <button class="btn" onclick={() => testNotification()} disabled={notifier.permission === 'unsupported' || notifier.permission === 'denied'}>Send test notification</button>
      <button class="btn" onclick={() => testNotification(10)} disabled={countdown > 0 || notifier.permission === 'unsupported' || notifier.permission === 'denied'}>
        {countdown ? `Sending in ${countdown}s…` : 'Test in 10 seconds'}
      </button>
    </div>
    {#if testMsg}<p class="result" class:ok={testMsg.ok}>{testMsg.text}</p>{/if}
    <dl>
      <dt>Permission</dt>
      <dd>{notifier.permission}</dd>
      {#if native}
      <dt>Scheduled with the system</dt>
      <dd>{nativeStatus.scheduled}</dd>
      <dt>App Group</dt>
      <dd>{nativeStatus.appGroup || 'unknown'} · {nativeStatus.containerAvailable ? 'available' : 'not available (widgets and share sheet off)'}</dd>
      {#if nativeStatus.lastError}<dt>Native error</dt><dd class="err">{nativeStatus.lastError}</dd>{/if}
      {:else}
      <dt>Service worker</dt>
      <dd>{notifier.worker}</dd>
      <dt>Installed app</dt>
      <dd>{standalone ? 'yes' : 'no (browser tab)'}</dd>
      <dt>Secure (HTTPS)</dt>
      <dd>{typeof isSecureContext !== 'undefined' && isSecureContext ? 'yes' : 'no — notifications need HTTPS'}</dd>
      {/if}
      {#if notifier.lastError}<dt>Last error</dt><dd class="err">{notifier.lastError}</dd>{/if}
    </dl>
    {#if upcoming.length}
      <ul class="upcoming">
        {#each upcoming.slice(0, 5) as r (r.taskId)}
          <li><span>{r.title}</span><span class="when">{reminderLabel(r.at, store.day)}</span></li>
        {/each}
      </ul>
    {/if}
    {#if native}
    <p class="note">
      Reminders are scheduled with the system, so they arrive even when OpenThings is closed. They are rescheduled whenever a reminder changes (up to {MAX_SCHEDULED} at a time).
    </p>
    {:else}
    <p class="note">
      For now reminders fire while OpenThings is open (any tab, or the installed app); ones missed while it was closed fire when you open it.
      Phones pause web apps in the background, so on a phone reminders only fire while the app is on screen — some systems don't show a banner for the app you're currently using; “Test in 10 seconds” lets you switch away first.
      Reminders that arrive with the app closed will come from the sync server (Web Push) and the native apps.
      {#if isIOS && !standalone}On iPhone, add OpenThings to your Home Screen first (Share → Add to Home Screen); Safari only allows notifications for installed web apps.{/if}
    </p>
    {/if}
  </section>

  <section>
    <header>
      <h2>REST API</h2>
    </header>
    <p class="lead">
      The server has a JSON API for scripts, Home Assistant, n8n and Shortcuts. Quick-add text works the same as in the app. No auth on your tailnet; device tokens are planned.
    </p>
    <dl>
      <dt>Base URL</dt>
      <dd><code>{base}/api/v1</code></dd>
    </dl>
    <table class="endpoints">
      <tbody>
        {#each endpoints as [method, path, what]}
          <tr><td class="method">{method}</td><td><code>{path}</code></td><td class="what">{what}</td></tr>
        {/each}
      </tbody>
    </table>
    <CodeBlock label="Example" code={curl} />
  </section>

  <section>
    <header>
      <h2>MCP</h2>
    </header>
    <p class="lead">
      AI assistants (Claude, and other MCP clients) can read and manage your to-dos through the MCP endpoint on the same server. Every change goes through the same op log as the app and syncs to your devices.
    </p>
    <dl>
      <dt>Endpoint</dt>
      <dd><code>{base}/mcp</code> (Streamable HTTP)</dd>
    </dl>
    <CodeBlock label="MCP config — clients that support remote (HTTP) servers" code={mcpHttp} />
    <CodeBlock label="MCP config — clients that only run local commands (via mcp-remote)" code={mcpStdio} />
    <CodeBlock label="Claude Code" code={mcpCli} />
    <h3>Tools</h3>
    <table class="endpoints">
      <tbody>
        {#each tools as [name, what]}
          <tr><td><code>{name}</code></td><td class="what">{what}</td></tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section>
    <header>
      <h2>Appearance</h2>
      <kbd title="Toggle dark mode">⇧D</kbd>
    </header>
    <div class="segmented" role="radiogroup" aria-label="Theme">
      {#each themes as [value, label]}
        <button role="radio" aria-checked={!theme.omarchy && theme.pref === value} class:on={!theme.omarchy && theme.pref === value} onclick={() => theme.set(value)}>{label}</button>
      {/each}
    </div>
    {#if !isTouch}
      <div class="omarchy">
        <span>Omarchy theme: <strong>{theme.palette?.name ?? 'None'}</strong></span>
        <button class="btn" onclick={() => (store.overlay = 'themes')}>Choose theme… <kbd>⇧T</kbd></button>
      </div>
    {/if}
    <p class="note">System follows your device's light/dark setting. Choices are saved on this device only.</p>
  </section>

  <section>
    <h2>Features</h2>
    {#each FEATURES as f (f.id)}
      <label class="toggle feature">
        <input type="checkbox" checked={features.enabled(f.id)} onchange={(e) => store.setFeature(f.id, e.currentTarget.checked)} />
        <span><strong>{f.label}</strong><small>{f.description}</small></span>
      </label>
    {/each}
    <p class="note">Turning a feature off hides it from the sidebar, Quick Find and shortcuts. Nothing is deleted, though Brain Dump items still expire after 48 hours. Saved on this device only.</p>
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

    {#if !isTouch}
      <h3>Import from Things 3</h3>
      <p class="lead">
        Importing a Things 3 database is only supported in the <strong>macOS desktop app</strong>. The browser version can't read the Things database from your Mac.
      </p>
      <p class="note">The macOS app finds <code>main.sqlite</code> in the Things group container automatically and imports it without a file picker.</p>
    {/if}
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
  .pill {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--text-2);
    background: var(--chip);
    border-radius: 10px;
    padding: 2px 9px;
    white-space: nowrap;
  }
  .err {
    color: var(--deadline);
  }
  .pill.ok {
    color: var(--logbook);
  }
  h3 {
    font-size: 13px;
    margin: 18px 0 6px;
  }
  .lead code,
  dd code,
  .endpoints code {
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 12px;
  }
  .endpoints {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
    margin: 6px 0 8px;
  }
  .endpoints td {
    padding: 6px 8px 6px 0;
    border-top: 1px solid var(--line);
    vertical-align: top;
  }
  .method {
    font-weight: 600;
    color: var(--text-2);
    white-space: nowrap;
    width: 1%;
  }
  .what {
    color: var(--text-2);
  }
  .upcoming {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    font-size: 13px;
  }
  .upcoming li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 5px 0;
    border-top: 1px solid var(--line);
  }
  .upcoming .when {
    color: var(--habits);
    white-space: nowrap;
  }
  .omarchy {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 12px;
    font-size: 14px;
  }
  .segmented {
    display: inline-flex;
    background: var(--chip);
    border-radius: 9px;
    padding: 3px;
    gap: 2px;
    margin-top: 4px;
  }
  .segmented button {
    font-size: 13px;
    font-weight: 500;
    padding: 6px 16px;
    border-radius: 7px;
    color: var(--text-2);
  }
  .segmented button.on {
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }
  .toggle {
    display: flex;
    gap: 10px;
    align-items: center;
    font-size: 14px;
  }
  .feature {
    align-items: flex-start;
    padding: 8px 0;
    min-height: 44px;
  }
  .feature input {
    margin-top: 2px;
    flex: none;
  }
  .feature span {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .feature small {
    font-size: 12.5px;
    color: var(--text-3);
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
    .endpoints tr {
      display: grid;
      grid-template-columns: auto 1fr;
      column-gap: 8px;
      border-top: 1px solid var(--line);
      padding: 6px 0;
    }
    .endpoints td {
      border: none;
      padding: 0;
    }
    .endpoints .what {
      grid-column: 1 / -1;
    }
  }
</style>
