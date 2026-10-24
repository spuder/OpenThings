/**
 * Native shell diagnostics shown in Settings. Kept apart from `capacitor.svelte.ts` so Settings can
 * read it without pulling the Capacitor plugins into the web bundle.
 */
export const nativeStatus = $state({
  /** Reminder notifications currently scheduled with the OS. */
  scheduled: 0,
  appGroup: '',
  containerAvailable: false,
  /** Android 12+: whether reminders may use exact alarms ("Alarms & reminders"). Null elsewhere. */
  exactAlarms: null as boolean | null,
  lastError: null as string | null,
});
