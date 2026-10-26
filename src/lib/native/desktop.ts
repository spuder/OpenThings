/**
 * Glue between the web app and the Tauri desktop shell (src-tauri/). Everything here is a no-op in
 * a browser, the PWA and the Docker build: callers check `isDesktop` first, and the Tauri API is
 * loaded lazily so the web bundle doesn't need it.
 *
 * Shell -> web (events, main window only):
 *   ot://command  <command id>   run a command from src/lib/commands.ts (menu bar)
 *   ot://add      <text>         add a to-do with quick-add syntax (quick-add window, deep link, CLI)
 *   ot://reveal   <task id>      open a task (notification click, openthings://task/<id>)
 *   ot://sync-now                tray "Sync Now"
 *   ot://will-quit               save the database, then call `quit_now`
 * Web -> shell (commands): set_sync_status, set_reminders, show_notification, quit_now, …
 *
 * See docs/desktop.md.
 */
import type { SyncState } from '../sync/protocol';
import type { NativeNotifier, UpcomingReminder } from '../reminders.svelte';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
  }
}

/** True inside the Tauri desktop app. */
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Label of this webview's window: "main" or "quickadd". */
export function windowLabel(): string {
  return (isDesktop && window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label) || 'main';
}

export const isMacDesktop = isDesktop && typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

export async function invoke<T = void>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args);
}

export async function listen<T>(event: string, fn: (payload: T) => void): Promise<() => void> {
  const ev = await import('@tauri-apps/api/event');
  return ev.listen<T>(event, (e) => fn(e.payload));
}

export interface DesktopInfo {
  platform: string;
  wayland: boolean;
  hotkey: string;
  defaultHotkey: string;
  hotkeysAvailable: boolean;
  hotkeyError: string | null;
  /** Hyprland: the shortcut is a bind OpenThings writes into this file (null elsewhere). */
  hyprlandConfig: string | null;
  /** Hyprland: that file is written and sourced by hyprland.conf. */
  hyprlandBound: boolean;
  autostart: boolean;
  version: string;
}

export const desktopInfo = () => invoke<DesktopInfo>('desktop_info');
export const setHotkey = (hotkey: string) => invoke('set_hotkey', { hotkey });
/** Release the global shortcut while Settings records a new one (false: restore it). */
export const pauseHotkey = (paused: boolean) => invoke('pause_hotkey', { paused });
export const setAutostart = (enabled: boolean) => invoke<boolean>('set_autostart', { enabled });

/** Short label for the tray tooltip and menu, like the in-app sync badge. */
export function syncLabel(s: SyncState): string {
  switch (s.status) {
    case 'local': return 'Local only';
    case 'idle': return 'Up to date';
    case 'pending': return `${s.pending} to sync`;
    case 'syncing': return 'Syncing…';
    case 'offline': return s.pending ? `Offline · ${s.pending} waiting` : 'Offline';
    case 'error': return `Error${s.error ? ': ' + s.error : ''}`;
  }
}

/**
 * Turn a keydown into a Tauri accelerator string ("Control+Alt+Space"), for the hotkey recorder in
 * Settings. Returns null for a lone modifier.
 */
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  const code = e.code;
  if (/^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/.test(code) || !code) return null;
  let key: string;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^F\d{1,2}$/.test(code)) key = code;
  else {
    const named: Record<string, string> = {
      Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
      Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', ArrowUp: 'Up', ArrowDown: 'Down',
      ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Escape', Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', End: 'End',
    };
    key = named[code];
    if (!key) return null;
  }
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  if (!mods.length) return null; // a global shortcut without modifiers would eat normal typing
  return [...mods, key].join('+');
}

/** Pretty label for an accelerator: "Control+Alt+Space" -> "⌃⌥Space" on macOS. */
export function acceleratorLabel(accel: string): string {
  if (!accel) return 'Off';
  const mac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
  const map: Record<string, string> = mac
    ? { Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', Super: '⌘', Command: '⌘', Cmd: '⌘', CmdOrCtrl: '⌘', CommandOrControl: '⌘' }
    : { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Super: 'Super', CmdOrCtrl: 'Ctrl', CommandOrControl: 'Ctrl' };
  const parts = accel.split('+').map((p) => map[p] ?? p);
  return parts.join(mac ? '' : '+');
}

interface MainHooks {
  /** Add a to-do from quick-add text (same parser and store as the in-app quick add). */
  add(text: string): void;
  reveal(taskId: string): void;
  runCommand(id: string): void;
  syncNow(): Promise<void>;
  subscribeSync(fn: (s: SyncState) => void): () => void;
  upcoming(): UpcomingReminder[];
  saveNow(): Promise<void>;
}

/**
 * Wire the main window to the shell. Call before the store initialises, so the native notifier is
 * set by the time reminders start firing.
 */
export function setupMainWindow(notifier: { useNative(n: NativeNotifier): void }, hooks: () => MainHooks) {
  if (!isDesktop) return;
  notifier.useNative({
    permission: async () => 'granted',
    request: async () => 'granted',
    show: (title, body, taskId) => invoke('show_notification', { title, body, taskId: taskId ?? null }),
    // Nothing is scheduled with the OS ahead of time: the app fires due reminders (including ones
    // missed while it was closed) and calls show; the Rust backstop only covers the last 5 minutes.
    schedulesAhead: false,
  });

  void listen<string>('ot://command', (id) => hooks().runCommand(id));
  void listen<string>('ot://add', (text) => hooks().add(text));
  void listen<string>('ot://reveal', (id) => hooks().reveal(id));
  void listen('ot://sync-now', () => void hooks().syncNow());
  void listen('ot://will-quit', async () => {
    try {
      await hooks().saveNow();
    } finally {
      await invoke('quit_now');
    }
  });

  const pushReminders = (list: UpcomingReminder[]) => void invoke('set_reminders', { reminders: list }).catch(() => {});
  window.addEventListener('openthings:reminders', (e) => pushReminders(e.detail));

  // The bridge exists once the store has initialised.
  const ready = setInterval(() => {
    if (!window.OpenThings) return;
    clearInterval(ready);
    pushReminders(hooks().upcoming());
    hooks().subscribeSync((s) => void invoke('set_sync_status', { info: { status: s.status, label: syncLabel(s) } }).catch(() => {}));
  }, 200);
}
