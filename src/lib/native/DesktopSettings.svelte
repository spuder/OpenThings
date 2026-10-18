<script lang="ts">
  /** "Desktop" section of Settings, shown only in the Tauri app. */
  import CodeBlock from '../ui/CodeBlock.svelte';
  import { acceleratorFromEvent, acceleratorLabel, desktopInfo, setAutostart, setHotkey, type DesktopInfo } from './desktop';

  let info = $state<DesktopInfo | null>(null);
  let recording = $state(false);
  let msg = $state<{ ok: boolean; text: string } | null>(null);

  async function refresh() {
    info = await desktopInfo();
  }
  void refresh();

  async function save(accel: string) {
    msg = null;
    try {
      await setHotkey(accel);
      msg = { ok: true, text: accel ? `Quick add is now ${acceleratorLabel(accel)}.` : 'Global shortcut turned off.' };
    } catch (e) {
      msg = { ok: false, text: String(e) };
    }
    await refresh();
  }

  function onRecordKey(e: KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return void (recording = false);
    const accel = acceleratorFromEvent(e);
    if (!accel) return;
    recording = false;
    void save(accel);
  }

  async function toggleAutostart(e: Event) {
    const want = (e.currentTarget as HTMLInputElement).checked;
    try {
      await setAutostart(want);
    } catch (err) {
      msg = { ok: false, text: `Launch at login: ${err}` };
    }
    await refresh();
  }

  const hyprland = `# ~/.config/hypr/bindings.conf (Omarchy) or hyprland.conf
# (Super+Space is Omarchy's launcher, so this uses Super+Alt+Space.)
bind = SUPER ALT, SPACE, exec, openthings --quick-add

# Float the quick-add window, centred and on top (Hyprland 0.53+)
windowrule {
  name = openthings-quick-add
  match:title = ^(OpenThings Quick Add)$
  float = on
  center = on
  pin = on
}`;
  const deepLink = `openthings --quick-add "Call dentist @fri %9am"   # open prefilled
openthings --add "Buy milk #errand"               # add without a window
xdg-open 'openthings://add?text=Buy%20milk'       # deep link`;
</script>

<section>
  <header>
    <h2>Desktop</h2>
    {#if info}<span class="pill">v{info.version} · {info.platform}{info.wayland ? ' · Wayland' : ''}</span>{/if}
  </header>
  <p class="lead">Quick add from anywhere, even when OpenThings is in the background. Closing the window keeps OpenThings running in the {info?.platform === 'macos' ? 'menu bar' : 'tray'} so reminders still arrive.</p>

  {#if info}
    {#if info.hotkeysAvailable}
      <div class="hotkey">
        <span>Global quick-add shortcut</span>
        <button
          class="btn recorder"
          class:recording
          onclick={() => (recording = !recording)}
          onkeydown={(e) => recording && onRecordKey(e)}
          onblur={() => (recording = false)}
          aria-label="Change global quick-add shortcut"
        >
          {recording ? 'Press keys… (Esc cancels)' : acceleratorLabel(info.hotkey)}
        </button>
      </div>
      <div class="row-actions">
        <button class="btn" onclick={() => save(info!.defaultHotkey)} disabled={info.hotkey === info.defaultHotkey}>Reset to {acceleratorLabel(info.defaultHotkey)}</button>
        <button class="btn" onclick={() => save('')} disabled={!info.hotkey}>Turn off</button>
      </div>
      {#if info.hotkeyError}<p class="result">{info.hotkeyError}</p>{/if}
    {:else}
      <p class="note">This is a Wayland session, where apps can't register global shortcuts. Bind a key in your compositor to <code>openthings --quick-add</code> instead:</p>
      <CodeBlock code={hyprland} label="Hyprland" />
    {/if}
    {#if msg}<p class="result" class:ok={msg.ok}>{msg.text}</p>{/if}

    <label class="toggle">
      <input type="checkbox" checked={info.autostart} onchange={toggleAutostart} />
      <span>Launch at login (starts hidden in the {info.platform === 'macos' ? 'menu bar' : 'tray'})</span>
    </label>

    {#if info.platform !== 'macos'}
      <h3>Command line and links</h3>
      <CodeBlock code={deepLink} label="Shell" />
    {/if}
  {/if}
</section>

<style>
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
  h3 {
    font-size: 13px;
    margin: 18px 0 6px;
  }
  .lead,
  .note {
    color: var(--text-2);
    font-size: 13.5px;
    margin: 4px 0 16px;
  }
  .note {
    font-size: 12.5px;
  }
  .hotkey {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 13.5px;
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
  .recorder {
    min-width: 150px;
    font-variant-numeric: tabular-nums;
  }
  .recorder.recording {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .result {
    font-size: 13px;
    color: var(--deadline);
    margin: 10px 0 0;
  }
  .result.ok {
    color: var(--logbook);
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
  .toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13.5px;
    margin-top: 18px;
    min-height: 44px;
  }
  code {
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 12px;
  }
</style>
