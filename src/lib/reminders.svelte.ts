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

class Notifier {
  permission = $state<NotifyPermission>(currentPermission());
  /** Service worker registration, when supported (needed for notifications on Android and iOS). */
  private registration: ServiceWorkerRegistration | null = null;

  async init(onOpenTask: (id: string) => void) {
    this.permission = currentPermission();
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !isSecureContext) return;
    try {
      this.registration = await navigator.serviceWorker.register('/sw.js');
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.type === 'openthings:open-task') onOpenTask(e.data.taskId);
      });
    } catch {
      this.registration = null;
    }
  }

  /** Must be called from a user gesture (click). */
  async request(): Promise<NotifyPermission> {
    if (typeof Notification === 'undefined') return (this.permission = 'unsupported');
    this.permission = (await Notification.requestPermission()) as NotifyPermission;
    return this.permission;
  }

  /** Show a system notification. Returns false if notifications aren't allowed. */
  async show(title: string, body: string, taskId?: string): Promise<boolean> {
    this.permission = currentPermission();
    if (this.permission !== 'granted') return false;
    const options: NotificationOptions = {
      body,
      tag: taskId ? `reminder-${taskId}` : undefined,
      data: { taskId },
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    };
    try {
      if (this.registration) {
        await this.registration.showNotification(title, options);
      } else {
        const n = new Notification(title, options);
        n.onclick = () => window.focus();
      }
      return true;
    } catch {
      return false;
    }
  }
}

export const notifier = new Notifier();
