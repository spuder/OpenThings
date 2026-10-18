/**
 * Bridge for native shells. The Tauri desktop app and Capacitor mobile apps load this same web code,
 * so they read sync state from here instead of re-implementing it:
 *
 *   window.OpenThings.sync.getState()          -> SyncState
 *   window.OpenThings.sync.subscribe(fn)       -> unsubscribe()
 *   window.OpenThings.sync.syncNow()           -> Promise<void>
 *   window.addEventListener('openthings:sync', (e) => e.detail as SyncState)
 *   window.OpenThings.reminders.upcoming()     -> [{ taskId, title, at }]
 *   window.addEventListener('openthings:reminders', …)  fired when that list changes
 *
 * Planned uses: Tauri tray icon and menu-bar badge; Capacitor writes the state to the App Group
 * so iOS widgets and Android widgets can show "synced 2m ago" or "offline".
 */
import type { SyncEngine } from './engine.svelte';
import type { SyncState } from './protocol';
import type { UpcomingReminder } from '../reminders.svelte';

export interface OpenThingsBridge {
  sync: {
    getState(): SyncState;
    subscribe(fn: (s: SyncState) => void): () => void;
    syncNow(): Promise<void>;
  };
  reminders: {
    /** Pending reminders, soonest first. Native shells schedule OS notifications from this. */
    upcoming(): UpcomingReminder[];
  };
}

declare global {
  interface Window {
    OpenThings?: OpenThingsBridge;
  }
  interface WindowEventMap {
    'openthings:sync': CustomEvent<SyncState>;
    'openthings:reminders': CustomEvent<UpcomingReminder[]>;
  }
}

export function installBridge(engine: SyncEngine, upcoming: () => UpcomingReminder[]) {
  if (typeof window === 'undefined') return;
  window.OpenThings = {
    sync: {
      getState: () => engine.state,
      subscribe: (fn) => engine.subscribe(fn),
      syncNow: () => engine.kick(),
    },
    reminders: { upcoming },
  };
  engine.subscribe((s) => window.dispatchEvent(new CustomEvent('openthings:sync', { detail: s })));
}
