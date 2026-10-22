/**
 * Capacitor (iOS and Android) integration. Loaded with a dynamic import only when
 * `isNativeShell()` is true, so none of this runs in the browser, PWA or Docker builds.
 * Android has notifications, the keyboard, links and the QR scanner; the widget snapshot and the
 * share inbox are iOS-only for now (see docs/android.md).
 *
 * What it does:
 *   - Schedules OS-level local notifications from `window.OpenThings.reminders.upcoming()` and
 *     reschedules them on every `openthings:reminders` event (they fire even when the app is closed).
 *   - Opens the task when a notification is tapped, and handles `openthings://…` links from widgets.
 *   - Writes a small JSON snapshot (Today, upcoming reminders, sync state) to the App Group for widgets.
 *   - Reports the on-screen keyboard height so lists and quick add stay above it.
 *   - Scans the pairing QR code from another device's Settings (`scanQrCode`) and opens
 *     `openthings://pair` links in Settings → Sync.
 *   - Imports to-dos that the Share extension or Shortcuts left in the App Group, through
 *     `store.addParsed`, so they land in the op log like any other write.
 *
 * Native side: ios/App/App/OpenThingsPlugin.swift and
 * android/app/src/main/java/io/github/spuder/openthings/OpenThingsPlugin.java (jsName "OpenThingsNative").
 * See docs/ios.md and docs/android.md.
 */
import { App } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';
import { setKeyboardHeight } from '../keyboard';
import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { notifier, type NotifyPermission, type UpcomingReminder } from '../reminders.svelte';
import { reminderLabel } from '../parse';
import { sync } from '../sync/engine.svelte';
import type { ID, ViewKey } from '../types';
import type { Parsed } from '../parse';
import type { Area, Project, Task } from '../types';
import { nativeStatus } from './status.svelte';
import { buildSnapshot, MAX_SCHEDULED, notificationId, pendingToParsed, type PendingItem } from './snapshot';
import { openRoute } from './links';
import { backStep } from './back';
import { tick } from 'svelte';
import { theme } from '../theme.svelte';

interface NativeShared {
  /** Write the widget snapshot into the App Group and reload widget timelines. */
  writeSnapshot(options: { json: string }): Promise<void>;
  /** Return and remove items queued by extensions, plus a route queued by an App Intent. */
  takePending(): Promise<{ items: PendingItem[]; route: string | null }>;
  /** Diagnostics for Settings. */
  info(): Promise<{ appGroup: string; containerAvailable: boolean }>;
  /** Open the camera and return the first QR code it reads. Rejects with code CANCELLED or DENIED. */
  scanQRCode(): Promise<{ value: string }>;
  addListener(event: 'pendingChanged', fn: () => void): Promise<{ remove: () => Promise<void> }>;
}

const Shared = registerPlugin<NativeShared>('OpenThingsNative');
/** The App Group (widgets, Share extension, Shortcuts) exists on iOS only; Android's plugin only scans QR codes. */
const appGroup = Capacitor.getPlatform() === 'ios';
const android = Capacitor.getPlatform() === 'android';

/**
 * Android 12+: may reminders use exact alarms? Without that permission (off by default on Android 14+),
 * asking for an exact alarm makes the plugin open the "Alarms & reminders" screen on every schedule, so
 * reminders are scheduled inexact instead, which Android may deliver a few minutes late. Settings
 * offers `allowExactReminders` to turn exact timing on.
 */
async function exactAllowed(): Promise<boolean> {
  if (!android) return true;
  try {
    const s = await LocalNotifications.checkExactNotificationSetting();
    nativeStatus.exactAlarms = s.exact_alarm === 'granted';
  } catch {
    nativeStatus.exactAlarms = false;
  }
  return nativeStatus.exactAlarms;
}

let latest: { list: UpcomingReminder[]; day: string } = { list: [], day: '' };

/** Android: open "Alarms & reminders" so reminders can use exact alarms, then reschedule them. */
export async function allowExactReminders() {
  if (!android) return;
  try {
    await LocalNotifications.changeExactNotificationSetting();
  } catch (e) {
    nativeStatus.lastError = (e as Error).message || String(e);
  }
  await exactAllowed();
  reschedule(latest.list, latest.day);
}

/** Scan a QR code with the camera. Null when the user closes the scanner. */
export async function scanQrCode(): Promise<string | null> {
  try {
    return (await Shared.scanQRCode()).value;
  } catch (e) {
    if ((e as { code?: string }).code === 'CANCELLED') return null;
    throw e;
  }
}

/** The slice of the store this module uses (keeps the import graph one-way). */
export interface NativeStoreApi {
  tasks: Task[];
  projects: Project[];
  areas: Area[];
  day: string;
  now: number;
  overlay: string | null;
  quickAddPrefill: string;
  view: ViewKey;
  sidebarOpen: boolean;
  expandedId: ID | null;
  readonly isMulti: boolean;
  selecting: boolean;
  clearMulti(): void;
  closeFocus(): void;
  reveal(id: ID): void;
  go(v: ViewKey): void;
  addParsed(p: Parsed, opts: { useContext: boolean }): ID | null;
  notify(text: string): void;
}

/**
 * Android: light or dark status and navigation bar icons to match the app's theme, which can differ
 * from the system's (Settings → Appearance, Omarchy themes). The page draws behind the bars.
 */
function followTheme() {
  let last: boolean | null = null;
  const apply = () => {
    const dark = theme.isDark;
    if (dark === last) return;
    last = dark;
    // SystemBarsStyle.Dark means light icons, for a dark background.
    void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
  };
  $effect.root(() => {
    $effect(() => {
      void theme.pref;
      void theme.omarchy;
      apply();
    });
  });
  // "System" follows the phone's dark mode, which can change while the app is open.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
}

/** What's open, to tell whether an Escape closed anything. */
function openState(store: NativeStoreApi): string {
  return JSON.stringify([store.overlay, store.sidebarOpen, store.expandedId, store.isMulti, store.selecting, document.querySelectorAll('[role="menu"]').length]);
}

/** Android back button / gesture: step out one level (src/lib/native/back.ts). */
async function goBack(store: NativeStoreApi) {
  const step = backStep({
    sidebarOpen: store.sidebarOpen,
    overlay: store.overlay,
    expandedId: store.expandedId,
    isMulti: store.isMulti,
    selecting: store.selecting,
    menuOpen: !!document.querySelector('[role="menu"]'),
    viewKind: store.view.kind,
  });
  if (step === 'drawer') store.sidebarOpen = false;
  else if (step === 'today') store.go({ kind: 'today' });
  else if (step === 'exit') await App.minimizeApp();
  else {
    // Send Escape to whatever has focus (a field in quick add, the open to-do's notes…) so it closes
    // the way it does from a keyboard, saving what was typed. If nothing listened, close it here.
    const before = openState(store);
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    await tick();
    if (openState(store) !== before) return;
    if (store.overlay === 'focus') store.closeFocus();
    else if (store.overlay) store.overlay = null;
    else if (store.expandedId) store.expandedId = null;
    else store.clearMulti();
  }
}

function mapPermission(p: string): NotifyPermission {
  if (p === 'granted') return 'granted';
  if (p === 'denied') return 'denied';
  return 'default';
}

let scheduling: Promise<void> = Promise.resolve();

/** Cancel every reminder notification we scheduled and schedule the current list. Serialized. */
function reschedule(list: UpcomingReminder[], day: string) {
  // Reminders that were upcoming last time and aren't now: completed, deleted, moved, or just fired
  // by the app's own timer (store.fireDueReminders). The ones whose time has passed were fired.
  const dropped = latest.list.filter((r) => !list.some((l) => l.taskId === r.taskId));
  latest = { list, day };
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
      // Android delivers inexact alarms minutes late, and keeps the app running for a while after it
      // leaves the screen, so the app's own timer can fire a reminder first. If the app isn't on
      // screen nobody saw its chime and message: post it now instead of dropping it with the cancel
      // above. Skip any that Android already shows: getPending() on Android also lists delivered
      // notifications until they're tapped or dismissed, so `ours` alone would post them twice.
      if (android && document.visibilityState === 'hidden') {
        const fired = new Set(dropped.filter((r) => Date.parse(r.at) <= now).map((r) => notificationId(r.taskId)));
        const shown = new Set((await LocalNotifications.getDeliveredNotifications()).notifications.map((n) => n.id));
        const missed = ours.filter((n) => fired.has(n.id) && !shown.has(n.id));
        if (missed.length) {
          await LocalNotifications.schedule({
            notifications: missed.map((n) => ({ id: n.id, title: n.title, body: n.body, extra: n.extra, isExactNotification: false })),
          });
        }
      }
      const next = list.filter((r) => Date.parse(r.at) > now).slice(0, MAX_SCHEDULED);
      if (next.length) {
        const exact = await exactAllowed();
        await LocalNotifications.schedule({
          notifications: next.map((r) => ({
            id: notificationId(r.taskId),
            title: r.title,
            body: `Reminder · ${reminderLabel(r.at, day)}`,
            schedule: { at: new Date(r.at), allowWhileIdle: true },
            isExactNotification: exact,
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

  // The keyboard overlays the web view (resize: none in capacitor.config.ts); lists and quick add
  // make room for it from these events. See src/lib/keyboard.ts.
  await Keyboard.addListener('keyboardWillShow', (e) => setKeyboardHeight(e.keyboardHeight));
  await Keyboard.addListener('keyboardWillHide', () => setKeyboardHeight(0));

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
            // Shown right away: no alarm, so never the exact-alarm settings screen on Android.
            isExactNotification: false,
            extra: { kind: 'adhoc', taskId: taskId ?? null },
          },
        ],
      });
    },
  });

  // ---- notifications ----
  window.addEventListener('openthings:reminders', (e) => reschedule(e.detail, store.day));
  reschedule(upcoming(), store.day);
  if (android) {
    // Settings shows whether exact timing is on, and it can change in Android's settings while
    // OpenThings is in the background: check again on return, and reschedule if it changed.
    await exactAllowed();
    await App.addListener('resume', async () => {
      const before = nativeStatus.exactAlarms;
      if ((await exactAllowed()) !== before) reschedule(upcoming(), store.day);
    });
    // Without a listener Capacitor closes the app on back, whatever is open.
    await App.addListener('backButton', () => void goBack(store));
    followTheme();
  }

  await LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
    const taskId = (a.notification.extra as { taskId?: string } | undefined)?.taskId;
    if (taskId) store.reveal(taskId);
  });

  // Same message the service worker sends on the web; native code can post it too.
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'openthings:open-task' && typeof e.data.taskId === 'string') store.reveal(e.data.taskId);
  });

  // ---- deep links from widgets and Shortcuts ----
  await App.addListener('appUrlOpen', (e) => openRoute(e.url));

  if (appGroup) await startAppGroup(store, upcoming);
}

/** iOS: import to-dos from the Share extension and Shortcuts, and keep the widget snapshot current. */
async function startAppGroup(store: NativeStoreApi, upcoming: () => UpcomingReminder[]) {
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
