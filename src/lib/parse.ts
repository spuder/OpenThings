/**
 * Quick-add parser. Shared by the quick-add window, in-app entry, and the server's REST API and MCP tools.
 *
 *   #tag              tag (letters, digits, - _ /)
 *   +Project          project or area (hyphens/underscores match spaces)
 *   @today @tonight @tomorrow @someday @anytime @inbox
 *   @fri @next-week @in3d @2w @2026-11-02 @nov-3   when (scheduled)
 *   @dump  @dump/Section                            brain dump (expires in 48h)
 *   !fri !2026-11-02                                deadline
 *   ~30m ~1h ~1h30m                                 time estimate
 *   *daily *weekly *monthly *yearly *weekdays *2d *3w   repeat
 *   *mon,thu *2w-mon,thu *1st,15th *last-fri *2nd-tue  repeat on days (see parseRepeat)
 *   ^u ^i ^ui  (or #urgent #important)              Eisenhower: urgent / important
 *   %9am %18:30 %fri-9am %tomorrow-8am %in30m %in2h   reminder (notification)
 *   title // notes                                  everything after // becomes notes
 */
import * as chrono from 'chrono-node';
import { addDays, addMonths, nextWeekday, parseYmd, today as todayFn, weekdayIndex, ymd } from './dates';
import { advance, describe, emptyRule, firstDate, formatRule, nextDate, parseRule, pinRule, WEEKDAYS, type Rule } from './rrule';

export interface When {
  date: string | null;
  evening: boolean;
  someday: boolean;
  /** Explicitly no date and no project placement (Inbox). */
  inbox: boolean;
}

/** What opens quick add as the plain Brain Dump box (the B key, the Brain Dump widget). */
export const DUMP_PREFILL = '@dump ';

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

export function parseWhen(word: string, ref: string): When | null {
  const w = word.toLowerCase();
  if (w === 'tonight' || w === 'evening' || w === 'eve') return { date: ref, evening: true, someday: false, inbox: false };
  if (w === 'someday' || w === 'later') return { date: null, evening: false, someday: true, inbox: false };
  if (w === 'anytime') return { date: null, evening: false, someday: false, inbox: false };
  if (w === 'inbox') return { date: null, evening: false, someday: false, inbox: true };
  const d = parseDateWord(w, ref);
  return d ? { date: d, evening: false, someday: false, inbox: false } : null;
}

export function parseEstimate(s: string): number | null {
  const m = /^(?:(\d+)h)?(?:(\d+)m?)?$/.exec(s.toLowerCase());
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}

const ORDINAL_WORDS: Record<string, number> = {
  '1st': 1, first: 1, '2nd': 2, second: 2, '3rd': 3, third: 3, '4th': 4, fourth: 4, '5th': 5, fifth: 5, last: -1,
};
const isDayName = (w: string) => DAY_NAMES.test(w);
const ruleText = (r: Partial<Rule> & { freq: Rule['freq'] }) => formatRule({ ...emptyRule(r.freq), ...r });

/**
 * Quick-add repeat syntax (after `*`) to an RRULE string, or null:
 *   daily weekly monthly yearly weekdays weekends   2d 3w 2m 1y (every N days/weeks/months/years)
 *   mon  mon,thu  2w-mon,thu                         weekly on those days (every 2 weeks)
 *   15th  1st,15th  1st,last  last-day               monthly on those days of the month
 *   2nd-tue  last-fri  first-mon  last-weekday       monthly on an ordinal weekday
 */
export function parseRepeat(s: string): string | null {
  const w = s.toLowerCase().trim();
  const named: Record<string, string> = {
    daily: 'FREQ=DAILY;INTERVAL=1',
    weekly: 'FREQ=WEEKLY;INTERVAL=1',
    monthly: 'FREQ=MONTHLY;INTERVAL=1',
    yearly: 'FREQ=YEARLY;INTERVAL=1',
    annually: 'FREQ=YEARLY;INTERVAL=1',
    weekdays: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR',
    weekends: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=SA,SU',
  };
  if (named[w]) return named[w];
  const every = /^(\d+)([dwmy])$/.exec(w);
  if (every) {
    const n = Number(every[1]);
    if (n < 1) return null;
    const freq = ({ d: 'DAILY', w: 'WEEKLY', m: 'MONTHLY', y: 'YEARLY' } as const)[every[2] as 'd' | 'w' | 'm' | 'y'];
    return `FREQ=${freq};INTERVAL=${n}`;
  }
  // Weekly on days: "mon,thu", optionally every N weeks: "2w-mon,thu".
  const weekly = /^(?:(\d+)w-)?([a-z]+(?:,[a-z]+)*)$/.exec(w);
  if (weekly && weekly[2].split(',').every(isDayName)) {
    const interval = Number(weekly[1] ?? 1);
    if (interval < 1) return null;
    return ruleText({ freq: 'WEEKLY', interval, byDay: weekly[2].split(',').map((d) => ({ day: weekdayIndex(d), n: 0 })) });
  }
  // Monthly on an ordinal weekday: "2nd-tue", "last-fri", "last-weekday", "last-day".
  const ord = /^([a-z0-9]+)-([a-z]+)$/.exec(w);
  if (ord && ORDINAL_WORDS[ord[1]] !== undefined) {
    const n = ORDINAL_WORDS[ord[1]];
    if (isDayName(ord[2])) return ruleText({ freq: 'MONTHLY', byDay: [{ day: weekdayIndex(ord[2]), n }] });
    if (ord[2] === 'weekday') return ruleText({ freq: 'MONTHLY', byDay: WEEKDAYS.map((day) => ({ day, n: 0 })), bySetPos: [n] });
    if (ord[2] === 'day') return ruleText({ freq: 'MONTHLY', byMonthDay: [n] });
    return null;
  }
  // Monthly on days of the month: "15th", "1st,15th", "1st,last".
  const days = w.split(',');
  if (days.every((d) => d === 'last' || /^([1-9]|[12]\d|3[01])(st|nd|rd|th)$/.test(d))) {
    return ruleText({ freq: 'MONTHLY', byMonthDay: days.map((d) => (d === 'last' ? -1 : parseInt(d, 10))) });
  }
  return null;
}

/** Readable label: "Weekdays", "Every 2 weeks on Mon, Thu", "Monthly on the last Friday". */
export function describeRule(rrule: string, ref: string = todayFn()): string {
  const r = parseRule(rrule);
  return r ? describe(r, ref) : 'Repeats';
}

/**
 * Next date for a rule after `from` (the completed occurrence's date, or today if that's later).
 * `anchor` is the completed to-do's own date, so "every 2 weeks" keeps to its weeks. Null when the
 * repeat has ended (COUNT used up, past UNTIL) or the rule can't be read.
 */
export function nextOccurrence(rrule: string, from: string, anchor: string = from): string | null {
  const r = parseRule(rrule);
  return r ? nextDate(r, from, anchor) : null;
}

/**
 * What completing a repeating to-do creates: the next date and the rule the new to-do carries
 * (COUNT one lower; otherwise the same text). Null when the repeat has ended. Used by the app and the server.
 */
export function nextRepeat(rrule: string, from: string, anchor: string = from): { date: string; rrule: string } | null {
  const r = parseRule(rrule);
  const next = r && advance(r, from, anchor);
  if (!next) return null;
  return { date: next.date, rrule: r.count === null ? rrule : formatRule(next.rule) };
}

/** Where a new repeating to-do starting at `start` goes: the first matching day on or after it. */
export function firstOccurrence(rrule: string, start: string): string | null {
  const r = parseRule(rrule);
  return r ? firstDate(r, start) : null;
}

/** pinRule (see rrule.ts) for stored text: unchanged unless the start day needs pinning. */
export function pinRepeat(rrule: string, start: string): string {
  const r = parseRule(rrule);
  if (!r) return rrule;
  const pinned = pinRule(r, start);
  return pinned === r ? rrule : formatRule(pinned);
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
      // A to-do is in one project: a later +Project replaces an earlier one, and only it shows as a chip.
      const project = body.replace(/[-_]/g, ' ');
      if (out.project) {
        out.tokens = out.tokens.filter((t) => t.kind !== 'project');
        out.warnings.push(`One project per to-do: using "${project}"`);
      }
      out.project = project;
      out.tokens.push({ text: raw, kind: 'project', label: project });
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
        out.tokens.push({ text: raw, kind: 'repeat', label: describeRule(rule, ref) });
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
  if (out.rrule) {
    // A repeating task with no start date starts on its first matching day from today.
    if (!out.when) out.when = { date: firstOccurrence(out.rrule, ref) ?? ref, evening: false, someday: false, inbox: false };
    if (out.when.date) {
      out.rrule = pinRepeat(out.rrule, out.when.date);
      const tok = out.tokens.find((t) => t.kind === 'repeat');
      if (tok) tok.label = describeRule(out.rrule, ref);
    }
  }
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

export interface HabitInput {
  name: string;
  /** Challenge length in days, or null. */
  target: number | null;
  /** Schedule string (see views.ts parseSchedule), or null for daily. */
  schedule: string | null;
}

/**
 * Trailing words set habit options: "Cold shower 75d" (75-day challenge), "Gym 5x" (5 times a week),
 * "Journal weekdays", combinable: "Gym 4x 60d".
 */
export function parseHabit(input: string): HabitInput {
  let name = input.trim();
  let target: number | null = null;
  let schedule: string | null = null;
  for (let i = 0; i < 3; i++) {
    let m: RegExpExecArray | null;
    if ((m = /\s+(\d{1,3})\s*d(?:ays?)?$/i.exec(name)) && !target) {
      target = Number(m[1]);
    } else if ((m = /\s+([1-7])\s*x(?:\s*\/?\s*w(?:ee)?k)?$/i.exec(name)) && !schedule) {
      schedule = m[1] === '7' ? 'daily' : `times:${m[1]}`;
    } else if ((m = /\s+(weekdays|weekends|daily)$/i.exec(name)) && !schedule) {
      const w = m[1].toLowerCase();
      schedule = w === 'weekdays' ? 'days:1,2,3,4,5' : w === 'weekends' ? 'days:0,6' : 'daily';
    } else break;
    name = name.slice(0, m.index).trim();
  }
  return { name, target, schedule };
}

export interface TagCompletion {
  /** Index of the first character after `#`. */
  start: number;
  /** What's typed so far (without `#`). */
  typed: string;
  /** Best matching tag, in its stored spelling. */
  suggestion: string;
  /** The rest of `suggestion` after `typed`: shown as ghost text, never inserted while typing. */
  ghost: string;
  /** Where one Tab press goes: the shared prefix of every match, or the next `/ - _` segment. */
  step: string;
}

/**
 * Inline completion for the `#tag` being typed just before `caret`. `names` are the known tags,
 * best first (the first match wins). Tags already used elsewhere in the text are skipped.
 */
export function tagCompletion(text: string, caret: number, names: string[]): TagCompletion | null {
  if (/^\S/.test(text.slice(caret))) return null;
  const before = text.slice(0, caret);
  if (before.includes('//')) return null;
  const m = /(^|\s)#([\p{L}][\p{L}\p{N}_\-/]*)$/u.exec(before);
  if (!m) return null;
  const typed = m[2];
  const start = caret - typed.length;
  const lower = typed.toLowerCase();
  const used = new Set(
    (text.slice(0, start - 1) + ' ' + text.slice(caret)).match(/(?:^|\s)#[^\s#]+/g)?.map((w) => w.trim().slice(1).toLowerCase()) ?? [],
  );
  const seen = new Set<string>();
  const matches = names.filter((n) => {
    const l = n.toLowerCase();
    if (l.length <= lower.length || !l.startsWith(lower) || used.has(l) || seen.has(l)) return false;
    seen.add(l);
    return true;
  });
  if (!matches.length) return null;
  const suggestion = matches[0];

  let common = suggestion.length;
  for (const n of matches) {
    let i = lower.length;
    while (i < common && n[i]?.toLowerCase() === suggestion[i].toLowerCase()) i++;
    common = i;
  }
  // Ambiguous right here: step along the best match instead, one segment at a time.
  let end = common > lower.length ? common : suggestion.length;
  const sep = suggestion.slice(lower.length, end).search(/[/\-_]/);
  if (sep >= 0) end = lower.length + sep + 1;

  return { start, typed, suggestion, ghost: suggestion.slice(typed.length), step: suggestion.slice(0, end) };
}

/** The `+project` being typed just before the caret, a bare `+` included. */
export interface ProjectFragment {
  /** Index of the `+`. */
  start: number;
  /** What's typed after the `+`. */
  typed: string;
}

export function projectFragment(text: string, caret: number): ProjectFragment | null {
  if (/^\S/.test(text.slice(caret))) return null;
  const before = text.slice(0, caret);
  if (before.includes('//')) return null;
  const m = /(^|\s)\+([\p{L}\p{N}]\S*)?$/u.exec(before);
  if (!m) return null;
  const typed = m[2] ?? '';
  return { start: caret - typed.length - 1, typed };
}

/** The quick-add token for a project or area name, as the parser reads it back (`+Garage-cleanout`). */
export function projectToken(name: string): string {
  return `+${name.trim().replace(/\s+/g, '-')}`;
}

/**
 * Put project `name` where `frag` is and drop every other `+project` token, since a to-do has one
 * project. Notes after `//` are left alone. Returns the new text and the caret, after the token.
 */
export function setProject(text: string, frag: ProjectFragment, name: string): { text: string; caret: number } {
  const notesAt = text.indexOf('//');
  const head = notesAt >= 0 ? text.slice(0, notesAt) : text;
  const notes = notesAt >= 0 ? text.slice(notesAt) : '';
  const strip = (s: string) => s.replace(/(^|\s)\+[\p{L}\p{N}]\S*/gu, '$1').replace(/\s{2,}/g, ' ');
  const before = strip(head.slice(0, frag.start)).trim();
  const after = strip(head.slice(frag.start + 1 + frag.typed.length)).trim();
  const lead = `${before ? before + ' ' : ''}${projectToken(name)} `;
  const rest = [after, notes.trim()].filter(Boolean).join(' ');
  return { text: lead + rest, caret: lead.length };
}
