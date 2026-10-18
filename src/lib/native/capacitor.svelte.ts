/**
 * Capacitor (iOS today, Android later) integration. Loaded with a dynamic import only when
 * `isNativeShell()` is true, so none of this runs in the browser, PWA or Docker builds.
 *
 * What it does:
 *   - Schedules OS-level local notifications from `window.OpenThings.reminders.upcoming()` and
 *     reschedules them on every `openthings:reminders` event (they fire even when the app is closed).
 *   - Opens the task when a notification is tapped, and handles `openthings://…` links from widgets.
 *   - Writes a small JSON snapshot (Today, upcoming reminders, sync state) to the App Group for widgets.
 *   - Imports to-dos that the Share extension or Shortcuts left in the App Group, through
 *     `store.addParsed`, so they land in the op log like any other write.
 *
 * Native side: ios/App/App/OpenThingsPlugin.swift (jsName "OpenThingsNative"). See docs/ios.md.
 */
import { App } from '@capacitor/app';
import { registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { notifier, type NotifyPermission, type UpcomingReminder } from '../reminders.svelte';
import { reminderLabel } from '../parse';
import { sync } from '../sync/engine.svelte';
import type { ID, ViewKey } from '../types';
import type { Parsed } from '../parse';
import type { Area, Project, Task } from '../types';
import { nativeStatus } from './status.svelte';
import { buildSnapshot, MAX_SCHEDULED, notificationId, parseRoute, pendingToParsed, type PendingItem } from './snapshot';

interface NativeShared {
  /** Write the widget snapshot into the App Group and reload widget timelines. */
  writeSnapshot(options: { json: string }): Promise<void>;
  /** Return and remove items queued by extensions, plus a route queued by an App Intent. */
  takePending(): Promise<{ items: PendingItem[]; route: string | null }>;
  /** Diagnostics for Settings. */
  info(): Promise<{ appGroup: string; containerAvailable: boolean }>;
  addListener(event: 'pendingChanged', fn: () => void): Promise<{ remove: () => Promise<void> }>;
}

const Shared = registerPlugin<NativeShared>('OpenThingsNative');

/** The slice of the store this module uses (keeps the import graph one-way). */
export interface NativeStoreApi {
  tasks: Task[];
  projects: Project[];
  areas: Area[];
  day: string;
  now: number;
  overlay: string | null;
  quickAddPrefill: string;
  reveal(id: ID): void;
  go(v: ViewKey): void;
  addParsed(p: Parsed, opts: { useContext: boolean }): ID | null;
  notify(text: string): void;
}


function mapPermission(p: string): NotifyPermission {
  if (p === 'granted') return 'granted';
  if (p === 'denied') return 'denied';
  return 'default';
}

let scheduling: Promise<void> = Promise.resolve();

/** Cancel every reminder notification we scheduled and schedule the current list. Serialized. */
function reschedule(list: UpcomingReminder[], day: string) {
  scheduling = scheduling.then(async () => {
    try {
      const perm = await LocalNotifications.checkPermissions();
      notifier.permission = mapPermission(perm.display);
      if (perm.display !== 'granted') {
        nativeStatus.scheduled = 0;
        return;
      }
      const pending = await LocalNotifications.getPending();
      const ours = pending.notifications.filter((n) => (n.extra as { kind?: string } | undefined)?.kind === 'reminder');
      if (ours.length) await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
      const now = Date.now();
      const next = list.filter((r) => Date.parse(r.at) > now).slice(0, MAX_SCHEDULED);
      if (next.length) {
        await LocalNotifications.schedule({
          notifications: next.map((r) => ({
            id: notificationId(r.taskId),
            title: r.title,
            body: `Reminder · ${reminderLabel(r.at, day)}`,
            schedule: { at: new Date(r.at), allowWhileIdle: true },
            threadIdentifier: 'reminders',
            extra: { kind: 'reminder', taskId: r.taskId },
          })),
        });
      }
      nativeStatus.scheduled = next.length;
      nativeStatus.lastError = null;
    } catch (e) {
      nativeStatus.lastError = (e as Error).message || String(e);
    }
  });
}

export async function startNative(store: NativeStoreApi) {
  const upcoming = () => window.OpenThings?.reminders.upcoming() ?? [];

  // Reminders are delivered by the OS from here on; the in-app path only plays the chime and toast.
  notifier.useNative({
    async permission() {
      const p = await LocalNotifications.checkPermissions();
      return mapPermission(p.display);
    },
    async request() {
      const p = await LocalNotifications.requestPermissions();
      const mapped = mapPermission(p.display);
      if (mapped === 'granted') reschedule(upcoming(), store.day);
      return mapped;
    },
    async show(title, body, taskId) {
      await LocalNotifications.schedule({
        notifications: [
          {
            // Ad-hoc notifications (tests, focus sessions) get ids outside the reminder space.
            id: (Date.now() % 1_000_000_000) + 1,
            title,
            body,
            extra: { kind: 'adhoc', taskId: taskId ?? null },
          },
        ],
      });
    },
  });

  // ---- notifications ----
  window.addEventListener('openthings:reminders', (e) => reschedule(e.detail, store.day));
  reschedule(upcoming(), store.day);

  await LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
    const taskId = (a.notification.extra as { taskId?: string } | undefined)?.taskId;
    if (taskId) store.reveal(taskId);
  });

  // Same message the service worker sends on the web; native code can post it too.
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'openthings:open-task' && typeof e.data.taskId === 'string') store.reveal(e.data.taskId);
  });

  // ---- deep links from widgets and Shortcuts ----
  const openRoute = (url: string) => {
    const r = parseRoute(url);
    if (!r) return;
    if (r.kind === 'task') store.reveal(r.id);
    else if (r.kind === 'view') store.go({ kind: r.view });
    else {
      store.quickAddPrefill = r.text;
      store.overlay = 'quickadd';
    }
  };
  await App.addListener('appUrlOpen', (e) => openRoute(e.url));

  // ---- extension → app import ----
  let importing = false;
  const importPending = async () => {
    if (importing) return;
    importing = true;
    try {
      const { items, route } = await Shared.takePending();
      let added = 0;
      for (const item of items ?? []) {
        const p = pendingToParsed(item, store.day);
        if (p && store.addParsed(p, { useContext: false })) added++;
      }
      if (added) store.notify(added === 1 ? 'Added 1 shared to-do' : `Added ${added} shared to-dos`);
      if (route) openRoute(route);
    } catch (e) {
      nativeStatus.lastError = (e as Error).message || String(e);
    } finally {
      importing = false;
    }
  };
  await App.addListener('resume', () => void importPending());
  await App.addListener('appStateChange', (s) => {
    if (s.isActive) void importPending();
  });
  await Shared.addListener('pendingChanged', () => void importPending());
  void importPending();

  // ---- widget snapshot ----
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastJson = '';
  const writeSnapshot = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const snap = buildSnapshot({
        tasks: store.tasks,
        projects: store.projects,
        areas: store.areas,
        day: store.day,
        now: Date.now(),
        reminders: upcoming(),
        sync: sync.state,
      });
      // generatedAt changes every time; compare the rest so widgets only reload on real changes.
      const json = JSON.stringify({ ...snap, generatedAt: '' });
      if (json === lastJson) return;
      lastJson = json;
      try {
        await Shared.writeSnapshot({ json: JSON.stringify(snap) });
      } catch (e) {
        nativeStatus.lastError = (e as Error).message || String(e);
      }
    }, 400);
  };
  $effect.root(() => {
    $effect(() => {
      // Track what the snapshot depends on.
      void store.tasks;
      void store.projects;
      void store.areas;
      void store.day;
      writeSnapshot();
    });
  });
  window.addEventListener('openthings:sync', () => writeSnapshot());
  await App.addListener('pause', () => writeSnapshot());

  try {
    const info = await Shared.info();
    nativeStatus.appGroup = info.appGroup;
    nativeStatus.containerAvailable = info.containerAvailable;
  } catch (e) {
    nativeStatus.lastError = (e as Error).message || String(e);
  }
}
