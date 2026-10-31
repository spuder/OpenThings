/**
 * iCalendar (RFC 5545) for time blocks, so other calendars can subscribe to them: the server's
 * `.ics` feed and its read-only CalDAV collection both use this. Pure, shared by app and server.
 *
 * Blocks hold local wall-clock times, so events are "floating" (no time zone): 9:00 shows at 9:00
 * wherever the calendar is. When the server knows its zone, X-WR-TIMEZONE tells subscribers
 * (Google Calendar reads it) which one that is.
 *
 * Written from scratch for this project.
 */
import { areaColor } from './colors';
import { blockLabel } from './timeblocks';
import type { Area, Project, Task, TimeBlock } from './types';

export const DEFAULT_CALENDAR_NAME = 'OpenThings';
const PRODID = '-//OpenThings//Time Blocking//EN';

export interface CalEvent {
  uid: string;
  /** Local `YYYY-MM-DDTHH:MM`. */
  start: string;
  end: string;
  summary: string;
  description?: string;
  categories?: string;
  /** ISO timestamp (UTC), used for DTSTAMP and CREATED. */
  created: string;
  /** The block's area, which per-area calendars are split by; null = none (the "Other" calendar). */
  areaId?: string | null;
  /** CSS color name of the area (RFC 7986 COLOR), for clients that color single events. */
  color?: string;
}

/** A calendar's own color: hex for Apple's X-APPLE-CALENDAR-COLOR, a CSS name for RFC 7986 COLOR. */
export interface CalColor {
  hex: string;
  css: string;
}

/** Escape TEXT values: backslash, semicolon, comma and newlines. */
export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold a content line at 75 octets, continuing with a space (RFC 5545 §3.1). Never splits a UTF-8 character. */
export function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const max = out.length ? 74 : 75; // continuation lines start with a space
    if (len + n > max) {
      out.push(cur);
      cur = '';
      len = 0;
    }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** `2026-10-31T09:15` → `20261031T091500` (floating local time). */
export function localStamp(s: string): string {
  const [d, t = '00:00'] = s.split('T');
  return `${d.replace(/-/g, '')}T${t.slice(0, 5).replace(':', '')}00`;
}

/** ISO timestamp → `20261031T091500Z`. Falls back to the epoch for anything unparsable. */
export function utcStamp(iso: string): string {
  const ms = Date.parse(iso);
  return new Date(Number.isNaN(ms) ? 0 : ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function eventLines(e: CalEvent): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${utcStamp(e.created)}`,
    `CREATED:${utcStamp(e.created)}`,
    `DTSTART:${localStamp(e.start)}`,
    `DTEND:${localStamp(e.end)}`,
    `SUMMARY:${escapeText(e.summary)}`,
  ];
  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.categories) lines.push(`CATEGORIES:${escapeText(e.categories)}`);
  if (e.color) lines.push(`COLOR:${e.color}`);
  lines.push('TRANSP:OPAQUE', 'END:VEVENT');
  return lines;
}

/** A whole VCALENDAR, CRLF line endings, folded. */
export function calendar(events: CalEvent[], opts: { name?: string; timezone?: string; color?: CalColor } = {}): string {
  const name = opts.name?.trim() || DEFAULT_CALENDAR_NAME;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    `NAME:${escapeText(name)}`,
    ...(opts.timezone ? [`X-WR-TIMEZONE:${opts.timezone}`] : []),
    ...(opts.color ? [`COLOR:${opts.color.css}`, `X-APPLE-CALENDAR-COLOR:${opts.color.hex.toUpperCase()}`] : []),
    // Ask subscribers to refresh every 15 minutes.
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M',
    ...events.flatMap(eventLines),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Time blocks as events: titled like on the calendar, with the area › project path as description. */
export function blockEvents(blocks: TimeBlock[], areas: Area[], projects: Project[], tasks: Task[]): CalEvent[] {
  return blocks
    .filter((b) => !b.deleted_at)
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .map((b) => {
      const l = blockLabel(b, areas, projects, tasks);
      const area = b.area_id ? areas.find((a) => a.id === b.area_id) : undefined;
      return {
        uid: `${b.id}@openthings`,
        start: b.start_at,
        end: b.end_at,
        summary: l.title || 'Time block',
        description: l.crumbs.length ? [...l.crumbs, l.title].join(' › ') : undefined,
        categories: area?.name,
        created: b.created_at,
        areaId: area?.id ?? null,
        color: area ? areaColor(area.id, areas)?.css : undefined,
      };
    });
}

/** Short stable hash (FNV-1a, 32 bit) for ETags and the collection tag. */
export function etag(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
