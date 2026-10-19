/**
 * Quick-add parser. Shared by the quick-add window, in-app entry, and (later) CLI and HTTP API.
 *
 *   #tag              tag (letters, digits, - _ /)
 *   +Project          project or area (hyphens/underscores match spaces)
 *   @today @tonight @tomorrow @someday @anytime @inbox
 *   @fri @next-week @in3d @2w @2026-11-02 @nov-3   when (scheduled)
 *   @dump  @dump/Section                            brain dump (expires in 48h)
 *   !fri !2026-11-02                                deadline
 *   ~30m ~1h ~1h30m                                 time estimate
 *   *daily *weekly *monthly *yearly *weekdays *2d *3w   repeat
 *   ^u ^i ^ui  (or #urgent #important)              Eisenhower: urgent / important
 *   %9am %18:30 %fri-9am %tomorrow-8am %in30m %in2h   reminder (notification)
 *   title // notes                                  everything after // becomes notes
 */
import * as chrono from 'chrono-node';
import { addDays, addMonths, nextWeekday, parseYmd, today as todayFn, weekdayIndex, ymd } from './dates';

export interface When {
  date: string | null;
  evening: boolean;
  someday: boolean;
  /** Explicitly no date and no project placement (Inbox). */
  inbox: boolean;
}

export type TokenKind = 'tag' | 'project' | 'when' | 'deadline' | 'estimate' | 'repeat' | 'matrix' | 'dump' | 'reminder';

export interface Parsed {
  title: string;
  notes: string;
  tags: string[];
  project: string | null;
  when: When | null;
  deadline: string | null;
  estimateMin: number | null;
  /** Reminder time as an ISO timestamp (UTC). */
  reminderAt: string | null;
  rrule: string | null;
  urgent: boolean;
  important: boolean;
  dump: boolean;
  dumpSection: string | null;
  tokens: { text: string; kind: TokenKind; label: string }[];
  warnings: string[];
}

const DAY_NAMES = /^(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(day|nesday|sday|urday|rsday)?$/;

/** Parse a date word relative to `ref`. Returns YYYY-MM-DD or null. */
export function parseDateWord(word: string, ref: string): string | null {
  const w = word.toLowerCase();
  if (w === 'today' || w === 'tod' || w === 'now') return ref;
  if (w === 'tomorrow' || w === 'tom' || w === 'tmr') return addDays(ref, 1);
  if (w === 'yesterday') return addDays(ref, -1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w;
  if (DAY_NAMES.test(w)) return nextWeekday(ref, weekdayIndex(w));
  if (w === 'next-week' || w === 'nextweek') return nextWeekday(ref, 1);
  if (w === 'next-month' || w === 'nextmonth') {
    const d = parseYmd(addMonths(ref, 1));
    d.setDate(1);
    return ymd(d);
  }
  if (w === 'weekend') return nextWeekday(addDays(ref, -1), 6);
  const rel = /^(?:in)?(\d+)([dwm])$/.exec(w);
  if (rel) {
    const n = Number(rel[1]);
    if (rel[2] === 'd') return addDays(ref, n);
    if (rel[2] === 'w') return addDays(ref, n * 7);
    return addMonths(ref, n);
  }
  // Fallback: natural language ("nov-3", "next-friday", "dec-24").
  const text = w.replace(/[-_]/g, ' ');
  const d = chrono.parseDate(text, parseYmd(ref), { forwardDate: true });
  return d ? ymd(d) : null;
}

function parseWhen(word: string, ref: string): When | null {
  const w = word.toLowerCase();
  if (w === 'tonight' || w === 'evening' || w === 'eve') return { date: ref, evening: true, someday: false, inbox: false };
  if (w === 'someday' || w === 'later') return { date: null, evening: false, someday: true, inbox: false };
  if (w === 'anytime') return { date: null, evening: false, someday: false, inbox: false };
  if (w === 'inbox') return { date: null, evening: false, someday: false, inbox: true };
  const d = parseDateWord(w, ref);
  return d ? { date: d, evening: false, someday: false, inbox: false } : null;
}

function parseEstimate(s: string): number | null {
  const m = /^(?:(\d+)h)?(?:(\d+)m?)?$/.exec(s.toLowerCase());
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}

function parseRepeat(s: string): string | null {
  const w = s.toLowerCase();
  const named: Record<string, string> = {
    daily: 'FREQ=DAILY;INTERVAL=1',
    weekly: 'FREQ=WEEKLY;INTERVAL=1',
    monthly: 'FREQ=MONTHLY;INTERVAL=1',
    yearly: 'FREQ=YEARLY;INTERVAL=1',
    weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  };
  if (named[w]) return named[w];
  const m = /^(\d+)([dwmy])$/.exec(w);
  if (!m) return null;
  const freq = { d: 'DAILY', w: 'WEEKLY', m: 'MONTHLY', y: 'YEARLY' }[m[2] as 'd' | 'w' | 'm' | 'y'];
  return `FREQ=${freq};INTERVAL=${Number(m[1])}`;
}

export function describeRule(rrule: string): string {
  if (rrule.includes('BYDAY=MO,TU,WE,TH,FR')) return 'Weekdays';
  const freq = /FREQ=(\w+)/.exec(rrule)?.[1] ?? 'DAILY';
  const n = Number(/INTERVAL=(\d+)/.exec(rrule)?.[1] ?? 1);
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[freq] ?? 'day';
  if (n === 1) return { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', YEARLY: 'Yearly' }[freq] ?? 'Repeats';
  return `Every ${n} ${unit}s`;
}

/** Next date for a rule, counted from `from` (the completed occurrence's date or today). */
export function nextOccurrence(rrule: string, from: string): string {
  if (rrule.includes('BYDAY=MO,TU,WE,TH,FR')) {
    let d = addDays(from, 1);
    while ([0, 6].includes(parseYmd(d).getDay())) d = addDays(d, 1);
    return d;
  }
  const freq = /FREQ=(\w+)/.exec(rrule)?.[1] ?? 'DAILY';
  const n = Number(/INTERVAL=(\d+)/.exec(rrule)?.[1] ?? 1);
  if (freq === 'WEEKLY') return addDays(from, 7 * n);
  if (freq === 'MONTHLY') return addMonths(from, n);
  if (freq === 'YEARLY') return addMonths(from, 12 * n);
  return addDays(from, n);
}

/**
 * Parse a reminder: "9am", "9:30pm", "18:30", "in 30m", "in2h", "fri 9am", "tomorrow-8am", "nov 3 14:00".
 * A bare time lands on `baseDay`; if that's today and the time has passed, tomorrow.
 * A day without a time defaults to 9:00. Returns an ISO timestamp or null.
 */
export function parseReminder(spec: string, baseDay: string, now: Date = new Date()): string | null {
  const s = spec.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const rel = /^in ?(\d+) ?(m|min|mins|minutes?|h|hr|hrs|hours?)$/.exec(s);
  if (rel) {
    const ms = Number(rel[1]) * (rel[2].startsWith('h') ? 3_600_000 : 60_000);
    return new Date(now.getTime() + ms).toISOString();
  }
  const tm = /^(\d{1,2})(?::(\d{2}))? ?(am|pm|a|p)?$/.exec(s);
  if (tm) {
    let h = Number(tm[1]);
    const m = Number(tm[2] ?? 0);
    const ap = tm[3]?.[0];
    if (ap === 'p' && h < 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
    if (h > 23 || m > 59) return null;
    const d = parseYmd(baseDay);
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= now.getTime() && baseDay <= ymd(now)) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  const r = chrono.parse(s, now, { forwardDate: true })[0];
  if (!r) return null;
  const d = r.start.date();
  if (!r.start.isCertain('hour')) d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

/** "Today 9:00 AM", "Fri 6:30 PM", "Nov 3 9:00 AM". */
export function reminderLabel(iso: string, ref: string = todayFn()): string {
  const d = new Date(iso);
  const day = ymd(d);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const diff = Math.round((parseYmd(day).getTime() - parseYmd(ref).getTime()) / 86_400_000);
  const dayLabel =
    diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff > 1 && diff < 7 ? d.toLocaleDateString([], { weekday: 'short' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${dayLabel} ${time}`;
}

export function parseQuickAdd(input: string, ref: string = todayFn(), now: Date = new Date()): Parsed {
  const out: Parsed = {
    title: '',
    notes: '',
    tags: [],
    project: null,
    when: null,
    deadline: null,
    estimateMin: null,
    reminderAt: null,
    rrule: null,
    urgent: false,
    important: false,
    dump: false,
    dumpSection: null,
    tokens: [],
    warnings: [],
  };

  let text = input;
  const notesAt = text.indexOf('//');
  if (notesAt >= 0) {
    out.notes = text.slice(notesAt + 2).trim();
    text = text.slice(0, notesAt);
  }

  const words: string[] = [];
  let reminderSpec: { raw: string; spec: string } | null = null;
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const sigil = raw[0];
    const body = raw.slice(1);

    // Built-in tags: #urgent and #important set the Eisenhower flags (same as ^u / ^i) instead of adding a tag.
    if (sigil === '#' && /^(urgent|important)$/i.test(body)) {
      const urgent = body.toLowerCase() === 'urgent';
      if (urgent) out.urgent = true;
      else out.important = true;
      out.tokens.push({ text: raw, kind: 'matrix', label: urgent ? 'Urgent' : 'Important' });
      continue;
    }
    if (sigil === '#' && /^[\p{L}][\p{L}\p{N}_\-/]*$/u.test(body)) {
      if (!out.tags.includes(body)) out.tags.push(body);
      out.tokens.push({ text: raw, kind: 'tag', label: body });
      continue;
    }
    if (sigil === '+' && body.length > 0 && /^[\p{L}\p{N}]/u.test(body)) {
      out.project = body.replace(/[-_]/g, ' ');
      out.tokens.push({ text: raw, kind: 'project', label: out.project });
      continue;
    }
    if (sigil === '@' && body.length > 0) {
      const lower = body.toLowerCase();
      if (lower === 'dump' || lower.startsWith('dump/')) {
        out.dump = true;
        const section = body.slice(5).replace(/[-_]/g, ' ').trim();
        out.dumpSection = section || null;
        out.tokens.push({ text: raw, kind: 'dump', label: section ? `Brain dump / ${section}` : 'Brain dump' });
        continue;
      }
      const when = parseWhen(body, ref);
      if (when) {
        out.when = when;
        const label = when.someday ? 'Someday' : when.inbox ? 'Inbox' : when.evening ? 'This Evening' : when.date ?? 'Anytime';
        out.tokens.push({ text: raw, kind: 'when', label });
        continue;
      }
      out.warnings.push(`Unknown date "${body}"`);
    }
    if (sigil === '!' && body.length > 0) {
      const d = parseDateWord(body, ref);
      if (d) {
        out.deadline = d;
        out.tokens.push({ text: raw, kind: 'deadline', label: d });
        continue;
      }
    }
    if (sigil === '~' && body.length > 0) {
      const est = parseEstimate(body);
      if (est !== null) {
        out.estimateMin = est;
        out.tokens.push({ text: raw, kind: 'estimate', label: `${est}m` });
        continue;
      }
    }
    if (sigil === '*' && body.length > 0) {
      const rule = parseRepeat(body);
      if (rule) {
        out.rrule = rule;
        out.tokens.push({ text: raw, kind: 'repeat', label: describeRule(rule) });
        continue;
      }
    }
    if (sigil === '%' && body.length > 0) {
      reminderSpec = { raw, spec: body };
      continue;
    }
    if (sigil === '^' && /^[ui]{1,2}$/i.test(body)) {
      const b = body.toLowerCase();
      if (b.includes('u')) out.urgent = true;
      if (b.includes('i')) out.important = true;
      const label = [b.includes('u') && 'Urgent', b.includes('i') && 'Important'].filter(Boolean).join(' + ');
      out.tokens.push({ text: raw, kind: 'matrix', label });
      continue;
    }
    words.push(raw);
  }

  out.title = words.join(' ').trim();
  // A repeating task with no start date starts today.
  if (out.rrule && !out.when) out.when = { date: ref, evening: false, someday: false, inbox: false };
  if (reminderSpec) {
    // A bare time ("%9am") applies to the task's scheduled day, else today.
    const at = parseReminder(reminderSpec.spec, out.when?.date ?? ref, now);
    if (at) {
      out.reminderAt = at;
      out.tokens.push({ text: reminderSpec.raw, kind: 'reminder', label: reminderLabel(at, ref) });
    } else {
      out.warnings.push(`Unknown reminder "${reminderSpec.spec}"`);
      out.title = `${out.title} ${reminderSpec.raw}`.trim();
    }
  }
  return out;
}
