/** Local-date helpers. Dates are stored as YYYY-MM-DD strings in local time. */

export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today(now: Date = new Date()): string {
  return ymd(now);
}

export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function addMonths(s: string, n: number): string {
  const d = parseYmd(s);
  d.setMonth(d.getMonth() + n);
  return ymd(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86400000);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Short human label relative to `ref` (today). */
export function relLabel(s: string, ref: string = today()): string {
  const diff = daysBetween(ref, s);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const d = parseYmd(s);
  if (diff > 1 && diff < 7) return WEEKDAYS[d.getDay()];
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function longLabel(s: string): string {
  const d = parseYmd(s);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function weekdayIndex(name: string): number {
  const n = name.toLowerCase().slice(0, 3);
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(n);
}

/** Next occurrence of weekday (0-6) strictly after ref, unless it's today and allowToday. */
export function nextWeekday(ref: string, wd: number): string {
  const d = parseYmd(ref);
  let delta = (wd - d.getDay() + 7) % 7;
  if (delta === 0) delta = 7;
  return addDays(ref, delta);
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Move a reminder by the number of days between two schedule dates, keeping its time of day. */
export function shiftReminder(iso: string, fromDay: string, toDay: string): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + daysBetween(fromDay, toDay));
  return d.toISOString();
}
