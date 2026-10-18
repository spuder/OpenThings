/**
 * Reminder scheduler.
 *
 * While the app is open (browser tab, installed web app, or later the Tauri/Capacitor shells),
 * due reminders fire as system notifications through the service worker, with a chime and an
 * in-app toast. Reminders that came due while the app was closed fire when it next opens.
 *
 * Planned delivery paths reuse the same data (tasks.reminder_at):
 *   - Sync server + Web Push: reminders arrive while the app is closed (sw.js handles `push`).
 *   - Native shells: read `window.OpenThings.reminders.upcoming()` and schedule OS-level
 *     local notifications (Capacitor LocalNotifications, Tauri notification plugin).
 */
import type { Task } from './types';

export type NotifyPermission = 'unsupported' | 'default' | 'granted' | 'denied';

export interface UpcomingReminder {
  taskId: string;
  title: string;
  /** ISO timestamp (UTC). */
  at: string;
}

function currentPermission(): NotifyPermission {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as NotifyPermission;
}

/** Reminders that should fire now: pending, not done, not trashed, time reached. */
export function dueReminders(tasks: Task[], now: number): Task[] {
  return tasks.filter(
    (t) => t.reminder_at && !t.reminder_sent_at && !t.completed_at && !t.deleted_at && Date.parse(t.reminder_at) <= now,
  );
}

export function upcomingReminders(tasks: Task[], now: number): UpcomingReminder[] {
  return tasks
    .filter((t) => t.reminder_at && !t.reminder_sent_at && !t.completed_at && !t.deleted_at && Date.parse(t.reminder_at) > now)
    .sort((a, b) => a.reminder_at!.localeCompare(b.reminder_at!))
    .map((t) => ({ taskId: t.id, title: t.title, at: t.reminder_at! }));
}

/** Native shells (Capacitor) deliver notifications through the OS instead of the service worker. */
export interface NativeNotifier {
  permission(): Promise<NotifyPermission>;
  request(): Promise<NotifyPermission>;
  show(title: string, body: string, taskId?: string): Promise<void>;
}

class Notifier {
  permission = $state<NotifyPermission>(currentPermission());
  /** Service worker state; mobile browsers can only show notifications through an active worker. */
  worker = $state<'unsupported' | 'insecure' | 'registering' | 'active' | 'failed' | 'native'>('registering');
  private native: NativeNotifier | null = null;

  /** True when the OS schedules reminder notifications itself (native shells), so the app must not show them again. */
  get osDelivers(): boolean {
    return this.native !== null;
  }

  /** Called by the native shell module; from then on permission, request and show go through it. */
  useNative(n: NativeNotifier) {
    this.native = n;
    this.worker = 'native';
    void n.permission().then((p) => (this.permission = p));
  }
  /** Last delivery error, shown in Settings for troubleshooting. */
  lastError = $state<string | null>(null);

  async init(onOpenTask: (id: string) => void) {
    if (this.native) return;
    this.permission = currentPermission();
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return void (this.worker = 'unsupported');
    if (!isSecureContext) return void (this.worker = 'insecure');
    try {
      // BASE_URL keeps this working when the app is hosted under a sub-path (e.g. the GitHub Pages demo).
      await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.type === 'openthings:open-task') onOpenTask(e.data.taskId);
      });
      await this.activeRegistration();
    } catch (e) {
      this.worker = 'failed';
      this.lastError = `Service worker: ${(e as Error).message}`;
    }
  }

  /**
   * The registration once its worker is active. `register()` resolves before activation, and
   * showNotification() on a not-yet-active registration fails, which is what broke mobile.
   */
  private async activeRegistration(timeoutMs = 4000): Promise<ServiceWorkerRegistration | null> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !isSecureContext) return null;
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    this.worker = reg?.active ? 'active' : 'failed';
    return reg?.active ? reg : null;
  }

  /** Must be called from a user gesture (click). */
  async request(): Promise<NotifyPermission> {
    if (this.native) return (this.permission = await this.native.request());
    if (typeof Notification === 'undefined') return (this.permission = 'unsupported');
    this.permission = (await Notification.requestPermission()) as NotifyPermission;
    return this.permission;
  }

  /** Show a system notification. Returns false (and sets lastError) when it couldn't be shown. */
  async show(title: string, body: string, taskId?: string): Promise<boolean> {
    if (this.native) {
      try {
        this.permission = await this.native.permission();
        if (this.permission !== 'granted') {
          this.lastError = `Permission is "${this.permission}"`;
          return false;
        }
        await this.native.show(title, body, taskId);
        this.lastError = null;
        return true;
      } catch (e) {
        this.lastError = (e as Error).message || String(e);
        return false;
      }
    }
    this.permission = currentPermission();
    if (this.permission !== 'granted') {
      this.lastError = this.permission === 'unsupported' ? 'This browser has no notification support here' : `Permission is "${this.permission}"`;
      return false;
    }
    const options: NotificationOptions = {
      body,
      tag: taskId ? `reminder-${taskId}` : `openthings-${Date.now()}`,
      data: { taskId },
      icon: `${import.meta.env.BASE_URL}icon-192.png`,
      badge: `${import.meta.env.BASE_URL}icon-192.png`,
    };
    try {
      const reg = await this.activeRegistration();
      if (reg) {
        await reg.showNotification(title, options);
      } else {
        // Desktop browsers allow the constructor; mobile browsers throw ("Illegal constructor").
        const n = new Notification(title, options);
        n.onclick = () => window.focus();
      }
      this.lastError = null;
      return true;
    } catch (e) {
      this.lastError = (e as Error).message || String(e);
      return false;
    }
  }
}

export const notifier = new Notifier();
