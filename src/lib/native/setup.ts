/** Connects the main window's store, commands and sync engine to the desktop shell. See desktop.ts. */
import { store } from '../store.svelte';
import { commands } from '../commands';
import { sync } from '../sync/engine.svelte';
import { notifier, upcomingReminders } from '../reminders.svelte';
import { parseQuickAdd } from '../parse';
import * as db from '../db';
import { setupMainWindow } from './desktop';
import { openRoute } from './links';

export function setupDesktopMain() {
  setupMainWindow(notifier, () => ({
    add(text) {
      const p = parseQuickAdd(text, store.day);
      if (!p.title) return;
      // No view context: from outside the app, a to-do without a list goes to the Inbox.
      store.addParsed(p, { useContext: false });
      store.notify(`Added “${p.title}”`);
    },
    reveal: (id) => store.reveal(id),
    openUrl(url) {
      // A link opened from outside the app replaces whatever overlay is open.
      if (store.overlay) store.overlay = null;
      openRoute(url);
    },
    runCommand(id) {
      const cmd = commands.find((c) => c.id === id && (!c.when || c.when()));
      if (!cmd) return;
      // Menu commands act on the app, so close an open overlay first (except the one being toggled).
      if (store.overlay && id !== 'app.help') store.overlay = null;
      cmd.run();
    },
    syncNow: () => sync.kick(),
    subscribeSync: (fn) => sync.subscribe(fn),
    upcoming: () => upcomingReminders(store.tasks, Date.now()),
    saveNow: () => db.saveNow(),
  }));
}
