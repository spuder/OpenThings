/**
 * Repeat rules for to-dos: a subset of RFC 5545 RRULE, stored as text in `tasks.rrule`.
 * Pure (no browser imports), so the server schedules exactly the same next occurrence as the app.
 *
 * Supported parts: FREQ (DAILY, WEEKLY, MONTHLY, YEARLY), INTERVAL, BYDAY (MO, 2TU, -1FR),
 * BYMONTHDAY (1..31, -1..-31), BYMONTH, BYSETPOS, COUNT, UNTIL. Weeks start on Monday (the RFC
 * default WKST). Unknown parts are ignored.
 *
 * Where a to-do list differs from a calendar:
 * - There is no DTSTART. Periods are counted from an anchor: the current to-do's date.
 * - COUNT is how many occurrences are left, this one included. Each new occurrence carries COUNT - 1.
 * - A month day past the end of a short month (the 31st in April) falls on that month's last day
 *   instead of skipping the month.
 */
import { addDays, daysBetween, parseYmd, today as todayFn, ymd } from './dates';

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export const FREQS: Freq[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

/** A BYDAY entry: weekday 0 (Sun) to 6 (Sat); `n` is the ordinal in the month (2 = 2nd, -1 = last), 0 for every. */
export interface ByDay {
  day: number;
  n: number;
}

export interface Rule {
  freq: Freq;
  interval: number;
  byDay: ByDay[];
  byMonthDay: number[];
  byMonth: number[];
  bySetPos: number[];
  /** Occurrences left, this one included; null for no limit. */
  count: number | null;
  /** Last allowed date (YYYY-MM-DD), inclusive. */
  until: string | null;
}

export const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const WEEKEND = [6, 0];

export function emptyRule(freq: Freq = 'WEEKLY'): Rule {
  return { freq, interval: 1, byDay: [], byMonthDay: [], byMonth: [], bySetPos: [], count: null, until: null };
}

const ints = (v: string) => v.split(',').map((x) => (/^[+-]?\d+$/.test(x.trim()) ? Number(x) : NaN));

/** Parse "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH" (an optional "RRULE:" prefix is fine). Null if it isn't a usable rule. */
export function parseRule(text: string | null | undefined): Rule | null {
  const s = (text ?? '').trim().replace(/^RRULE:/i, '');
  if (!s) return null;
  const r = emptyRule('DAILY');
  let hasFreq = false;
  for (const part of s.split(';')) {
    if (!part.trim()) continue;
    const eq = part.indexOf('=');
    if (eq < 0) return null;
    const key = part.slice(0, eq).trim().toUpperCase();
    const v = part.slice(eq + 1).trim().toUpperCase();
    switch (key) {
      case 'FREQ':
        if (!FREQS.includes(v as Freq)) return null;
        r.freq = v as Freq;
        hasFreq = true;
        break;
      case 'INTERVAL': {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1) return null;
        r.interval = n;
        break;
      }
      case 'BYDAY':
        for (const item of v.split(',')) {
          const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(item.trim());
          if (!m) return null;
          const n = m[1] ? Number(m[1]) : 0;
          if (Math.abs(n) > 5) return null;
          r.byDay.push({ day: DAY_CODES.indexOf(m[2]), n });
        }
        break;
      case 'BYMONTHDAY':
        r.byMonthDay = ints(v);
        if (r.byMonthDay.some((d) => !Number.isInteger(d) || d === 0 || Math.abs(d) > 31)) return null;
        break;
      case 'BYMONTH':
        r.byMonth = ints(v);
        if (r.byMonth.some((m) => !Number.isInteger(m) || m < 1 || m > 12)) return null;
        break;
      case 'BYSETPOS':
        r.bySetPos = ints(v);
        if (r.bySetPos.some((p) => !Number.isInteger(p) || p === 0 || Math.abs(p) > 366)) return null;
        break;
      case 'COUNT': {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1) return null;
        r.count = n;
        break;
      }
      case 'UNTIL': {
        const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(v);
        if (!m) return null;
        r.until = `${m[1]}-${m[2]}-${m[3]}`;
        break;
      }
      default:
        break; // WKST and parts we don't schedule by.
    }
  }
  return hasFreq ? r : null;
}

/** Monday first, then by ordinal. */
const dayOrder = (d: number) => (d + 6) % 7;
/** 1st … 31st, then 2nd-to-last, last. */
const monthDayOrder = (v: number) => (v > 0 ? v : 64 + v);

function uniq<T>(xs: T[], key: (x: T) => string | number = (x) => String(x)): T[] {
  const seen = new Set<string | number>();
  return xs.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Canonical text: FREQ;INTERVAL;BYMONTH;BYDAY;BYMONTHDAY;BYSETPOS;COUNT;UNTIL, lists sorted. */
export function formatRule(r: Rule): string {
  const parts = [`FREQ=${r.freq}`, `INTERVAL=${Math.max(1, Math.floor(r.interval) || 1)}`];
  const months = uniq(r.byMonth).sort((a, b) => a - b);
  const days = uniq(r.byDay, (d) => `${d.n}${d.day}`).sort((a, b) => dayOrder(a.day) - dayOrder(b.day) || a.n - b.n);
  const monthDays = uniq(r.byMonthDay).sort((a, b) => monthDayOrder(a) - monthDayOrder(b));
  const setPos = uniq(r.bySetPos).sort((a, b) => monthDayOrder(a) - monthDayOrder(b));
  if (months.length) parts.push(`BYMONTH=${months.join(',')}`);
  if (days.length) parts.push(`BYDAY=${days.map((d) => `${d.n || ''}${DAY_CODES[d.day]}`).join(',')}`);
  if (monthDays.length) parts.push(`BYMONTHDAY=${monthDays.join(',')}`);
  if (setPos.length) parts.push(`BYSETPOS=${setPos.join(',')}`);
  if (r.count !== null) parts.push(`COUNT=${r.count}`);
  if (r.until) parts.push(`UNTIL=${r.until.replace(/-/g, '')}`);
  return parts.join(';');
}

// ---------- occurrences ----------

/** A Monday, so day and week indexes line up. */
const EPOCH = '1970-01-05';
const daysIn = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate();
const dateOf = (y: number, m0: number, d: number) => ymd(new Date(y, m0, d));

function period(freq: Freq, s: string): number {
  const d = parseYmd(s);
  switch (freq) {
    case 'DAILY': return daysBetween(EPOCH, s);
    case 'WEEKLY': return Math.floor(daysBetween(EPOCH, s) / 7);
    case 'MONTHLY': return d.getFullYear() * 12 + d.getMonth();
    case 'YEARLY': return d.getFullYear();
  }
}

function pick<T>(list: T[], positions: number[]): T[] {
  if (!positions.length) return list;
  const chosen = new Set<T>(positions.map((p) => (p > 0 ? list[p - 1] : list[list.length + p])).filter((x): x is T => x !== undefined));
  return list.filter((x) => chosen.has(x));
}

/** Days of one month that match the rule (BYSETPOS not applied yet). */
function monthDays(r: Rule, y: number, m0: number, anchorDay: number): number[] {
  const len = daysIn(y, m0);
  const resolve = (v: number) => (v > 0 ? Math.min(v, len) : len + v + 1);
  let days: number[];
  if (r.byDay.length) {
    const first = new Date(y, m0, 1).getDay();
    const set = new Set<number>();
    for (const { day, n } of r.byDay) {
      const all: number[] = [];
      for (let d = 1 + ((day - first + 7) % 7); d <= len; d += 7) all.push(d);
      if (n === 0) all.forEach((d) => set.add(d));
      else {
        const d = n > 0 ? all[n - 1] : all[all.length + n];
        if (d) set.add(d);
      }
    }
    days = [...set];
    if (r.byMonthDay.length) {
      const allowed = new Set(r.byMonthDay.map(resolve));
      days = days.filter((d) => allowed.has(d));
    }
  } else if (r.byMonthDay.length) {
    days = r.byMonthDay.map(resolve).filter((d) => d >= 1);
  } else {
    days = [Math.min(anchorDay, len)];
  }
  return [...new Set(days)].sort((a, b) => a - b);
}

/** The rule's dates within period `p`, sorted. */
function candidates(r: Rule, p: number, anchor: string): string[] {
  const a = parseYmd(anchor);
  switch (r.freq) {
    case 'DAILY': {
      const s = addDays(EPOCH, p);
      const d = parseYmd(s);
      if (r.byDay.length && !r.byDay.some((x) => x.day === d.getDay())) return [];
      if (r.byMonth.length && !r.byMonth.includes(d.getMonth() + 1)) return [];
      if (r.byMonthDay.length && !monthDays({ ...r, byDay: [] }, d.getFullYear(), d.getMonth(), d.getDate()).includes(d.getDate())) return [];
      return [s];
    }
    case 'WEEKLY': {
      const monday = addDays(EPOCH, p * 7);
      const days = r.byDay.length ? uniq(r.byDay.map((x) => x.day)) : [a.getDay()];
      const dates = days.map((d) => addDays(monday, dayOrder(d)))
        .filter((date) => !r.byMonth.length || r.byMonth.includes(parseYmd(date).getMonth() + 1))
        .sort();
      return pick(dates, r.bySetPos);
    }
    case 'MONTHLY': {
      const y = Math.floor(p / 12);
      const m0 = p - y * 12;
      if (r.byMonth.length && !r.byMonth.includes(m0 + 1)) return [];
      return pick(monthDays(r, y, m0, a.getDate()).map((d) => dateOf(y, m0, d)), r.bySetPos);
    }
    case 'YEARLY': {
      const months = r.byMonth.length
        ? [...r.byMonth].sort((x, y) => x - y)
        : r.byMonthDay.length || r.byDay.length
          ? Array.from({ length: 12 }, (_, i) => i + 1)
          : [a.getMonth() + 1];
      const annualOrdinal = !r.byMonth.length && r.byDay.some((x) => x.n !== 0);
      let dates = months.flatMap((m) => monthDays(
        annualOrdinal ? { ...r, byDay: [] } : r,
        p,
        m - 1,
        a.getDate(),
      ).map((d) => dateOf(p, m - 1, d)));
      if (annualOrdinal) {
        const weekdays = new Set<string>();
        for (const { day, n } of r.byDay) {
          const matching = months.flatMap((m) =>
            Array.from({ length: daysIn(p, m - 1) }, (_, i) => dateOf(p, m - 1, i + 1))
              .filter((date) => parseYmd(date).getDay() === day),
          );
          if (n === 0) matching.forEach((date) => weekdays.add(date));
          else {
            const date = n > 0 ? matching[n - 1] : matching[matching.length + n];
            if (date) weekdays.add(date);
          }
        }
        dates = r.byMonthDay.length
          ? dates.filter((date) => weekdays.has(date))
          : [...weekdays].sort();
      }
      return pick(dates, r.bySetPos);
    }
  }
}

/** First date of the rule strictly after `from`, counting periods from `anchor`. Ignores COUNT; respects UNTIL. */
function after(r: Rule, from: string, anchor: string): string | null {
  const start = period(r.freq, anchor);
  const interval = Math.max(1, r.interval);
  let k = Math.max(0, Math.floor((period(r.freq, from) - start) / interval));
  // Enough periods for any satisfiable rule (a 5th weekday or a month-specific day can be a year or more away).
  for (let i = 0; i < 1000; i++, k++) {
    for (const c of candidates(r, start + k * interval, anchor)) {
      if (c <= from) continue;
      return r.until && c > r.until ? null : c;
    }
  }
  return null;
}

/**
 * First occurrence on or after `start` (where a new repeating to-do is scheduled). The series counts its
 * periods from there, so "every 2 weeks on Mon" set up on a Sunday starts tomorrow, not in 8 days.
 */
export function firstDate(r: Rule, start: string): string | null {
  return after({ ...r, interval: 1 }, addDays(start, -1), start);
}

/**
 * Next occurrence after `from`. `anchor` is the current to-do's date: weeks/months are counted from it,
 * so "every 2 weeks" stays on its weeks even when a to-do is checked off late. Null when the rule is done.
 */
export function nextDate(r: Rule, from: string, anchor: string = from): string | null {
  if (r.count !== null && r.count <= 1) return null;
  return after(r, from, anchor);
}

/** The next occurrence and the rule it carries (one fewer left), or null when the repeat has ended. */
export function advance(r: Rule, from: string, anchor: string = from): { date: string; rule: Rule } | null {
  const date = nextDate(r, from, anchor);
  if (!date) return null;
  return { date, rule: { ...r, count: r.count === null ? null : r.count - 1 } };
}

/** Up to `n` dates of the series starting on or after `start`, as completing each one in turn would schedule them. */
export function previewDates(r: Rule, start: string, n: number): string[] {
  const out: string[] = [];
  let date = firstDate(r, start);
  let left = r.count;
  while (date && out.length < n) {
    out.push(date);
    if (left !== null && --left <= 0) break;
    date = after(r, date, date);
  }
  return out;
}

/**
 * Fix a plain monthly or yearly rule to its start day when that day doesn't exist in every month,
 * so the series doesn't drift (Jan 31 → Feb 28 → Mar 28): the 31st becomes "last day", Feb 29 stays Feb 29.
 */
export function pinRule(r: Rule, start: string): Rule {
  const d = parseYmd(start);
  const day = d.getDate();
  if (r.freq === 'MONTHLY' && !r.byDay.length && !r.byMonthDay.length && day >= 29) {
    return { ...r, byMonthDay: [day === 31 ? -1 : day] };
  }
  if (r.freq === 'YEARLY' && !r.byMonth.length && !r.byDay.length && !r.byMonthDay.length && d.getMonth() === 1 && day === 29) {
    return { ...r, byMonth: [2], byMonthDay: [29] };
  }
  return r;
}

// ---------- labels ----------

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** 2 → "2nd", -1 → "last", -2 → "2nd to last". */
export function position(n: number): string {
  if (n === -1) return 'last';
  return n < 0 ? `${ordinal(-n)} to last` : ordinal(n);
}

/** "a", "a and b", "a, b and c". */
function list(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

const sameDays = (a: number[], b: number[]) => a.length === b.length && b.every((d) => a.includes(d));

/** "weekday", "weekend day", "day", "Friday", "Sat or Sun". */
function dayNoun(days: number[]): string {
  if (sameDays(days, WEEKDAYS)) return 'weekday';
  if (sameDays(days, WEEKEND)) return 'weekend day';
  if (days.length === 7) return 'day';
  if (days.length === 1) return DAY_LONG[days[0]];
  return days.map((d) => DAY_SHORT[d]).join(' or ');
}

const sortedDays = (r: Rule) => uniq(r.byDay.map((d) => d.day)).sort((a, b) => dayOrder(a) - dayOrder(b));

/** "the 2nd Tuesday", "the 1st and 15th", "the last day", "the last weekday". Empty for a plain monthly rule. */
function monthPart(r: Rule): string {
  if (r.byDay.length) {
    const days = sortedDays(r);
    if (r.byDay.every((d) => d.n === 0)) {
      if (r.bySetPos.length) {
        const pos = [...r.bySetPos].sort((a, b) => monthDayOrder(a) - monthDayOrder(b));
        return `the ${list(pos.map(position))} ${dayNoun(days)}`;
      }
      if (r.byMonthDay.length === 1 && days.length === 1 && r.byMonthDay[0] > 0) return `${DAY_LONG[days[0]]} the ${ordinal(r.byMonthDay[0])}`;
      return `every ${days.map((d) => DAY_SHORT[d]).join(', ')}`;
    }
    const groups = days.map((day) => {
      const ns = r.byDay.filter((d) => d.day === day).map((d) => d.n);
      const label = ns.includes(0) ? 'every' : list([...ns].sort((a, b) => monthDayOrder(a) - monthDayOrder(b)).map(position));
      return `${label} ${DAY_LONG[day]}`;
    });
    return `the ${list(groups)}`;
  }
  if (r.byMonthDay.length) {
    const days = [...r.byMonthDay].sort((a, b) => monthDayOrder(a) - monthDayOrder(b));
    const labels = days.map((v) => (v > 0 ? ordinal(v) : `${position(v)} day`));
    return `the ${list(labels)}`;
  }
  return '';
}

function yearPart(r: Rule): string {
  if (!r.byMonth.length) return monthPart(r);
  const months = [...r.byMonth].sort((a, b) => a - b).map((m) => MONTH_SHORT[m - 1]);
  if (months.length === 1 && !r.byDay.length && r.byMonthDay.length === 1) {
    const v = r.byMonthDay[0];
    return v > 0 ? `${months[0]} ${v}` : `the ${position(v)} day of ${months[0]}`;
  }
  const on = monthPart(r);
  return on ? `${on} of ${months.join(', ')}` : `in ${months.join(', ')}`;
}

/** "Daily", "Every 2 weeks on Mon, Thu", "Monthly on the last Friday", "Weekly, 3 times", "Yearly, until Dec 31". */
export function describe(r: Rule, ref: string = todayFn()): string {
  const n = r.interval;
  const every = (one: string, unit: string) => (n === 1 ? one : `Every ${n} ${unit}s`);
  let base: string;
  switch (r.freq) {
    case 'DAILY':
      base = every('Daily', 'day');
      if (r.byDay.length) base += ` on ${sortedDays(r).map((d) => DAY_SHORT[d]).join(', ')}`;
      break;
    case 'WEEKLY': {
      const days = sortedDays(r);
      if (!days.length) base = every('Weekly', 'week');
      else if (n === 1 && !r.bySetPos.length && sameDays(days, WEEKDAYS)) base = 'Weekdays';
      else if (n === 1 && !r.bySetPos.length && sameDays(days, WEEKEND)) base = 'Weekends';
      else if (n === 1 && !r.bySetPos.length && days.length === 7) base = 'Daily';
      else base = `${every('Weekly', 'week')} on ${days.length === 1 ? DAY_LONG[days[0]] : days.map((d) => DAY_SHORT[d]).join(', ')}`;
      break;
    }
    case 'MONTHLY': {
      const on = monthPart(r);
      base = every('Monthly', 'month') + (on ? ` on ${on}` : '');
      if (r.byMonth.length) base += ` in ${[...r.byMonth].sort((a, b) => a - b).map((m) => MONTH_SHORT[m - 1]).join(', ')}`;
      break;
    }
    case 'YEARLY': {
      const on = yearPart(r);
      base = every('Yearly', 'year') + (on ? (on.startsWith('in ') ? ` ${on}` : ` on ${on}`) : '');
      break;
    }
  }
  if (r.count !== null) base += r.count === 1 ? ', last time' : `, ${r.count} times`;
  if (r.until) {
    const u = parseYmd(r.until);
    const year = u.getFullYear() !== parseYmd(ref).getFullYear() ? `, ${u.getFullYear()}` : '';
    base += `, until ${MONTH_SHORT[u.getMonth()]} ${u.getDate()}${year}`;
  }
  return base;
}
