/**
 * Calendar subscriptions for time blocks (#99): iCalendar feeds and a read-only CalDAV account,
 * so Apple Calendar, Google Calendar, Outlook, Thunderbird or DAVx5 can show them.
 *
 *   GET  /cal/openthings.ics       every block in one calendar (subscribe with webcal://…)
 *   GET  /cal/area/<id>.ics        one area's blocks;  /cal/other.ics  blocks with no area
 *   GET  /.well-known/caldav       → /dav/ (CalDAV discovery, RFC 6764)
 *   /dav/                          principal; calendar home /dav/calendars/ with one calendar per
 *                                  area (area-<id>/) and other/, each in its area's color
 *
 * The CalDAV account doesn't list the combined calendar, so adding it never shows a block twice;
 * the combined feed is for apps that subscribe to one URL. Calendar URLs use the area's id, so
 * renaming an area renames its calendar without breaking subscriptions.
 *
 * Read only: OpenThings stays the place blocks are edited, so PUT, DELETE and PROPPATCH are refused.
 * CalDAV support is the subset clients need: PROPFIND (depth 0 / 1), REPORT calendar-multiget and
 * calendar-query (with time-range), GET of one event. Change detection uses ETags and getctag.
 *
 * Written from scratch for this project (RFC 4918, RFC 4791).
 */
import { calendar, etag, type CalColor, type CalEvent } from '../src/lib/ical';
import { NO_AREA } from '../src/lib/colors';

/** An area as a calendar: its name and its color (picked, or automatic). */
export interface CalendarArea {
  id: string;
  name: string;
  color: CalColor;
}

export interface CalendarOptions {
  /** The combined calendar's name, and the prefix of the per-area ones ("OpenThings · Work"). Default "OpenThings". */
  name: string;
  /** IANA zone the floating times belong to, e.g. America/Denver. */
  timezone?: string;
  events: () => CalEvent[];
  areas: () => CalendarArea[];
}

const NS = {
  d: 'DAV:',
  c: 'urn:ietf:params:xml:ns:caldav',
  cs: 'http://calendarserver.org/ns/',
  ic: 'http://apple.com/ns/ical/',
} as const;
const PREFIX: Record<string, string> = Object.fromEntries(Object.entries(NS).map(([p, ns]) => [ns, p]));

export const FEED_PATH = '/cal/openthings.ics';
const ROOT = '/dav/';
const PRINCIPAL = '/dav/principal/';
const HOME = '/dav/calendars/';
const OTHER = 'other';

export function isCalendarPath(path: string): boolean {
  return (path.startsWith('/cal/') && path.endsWith('.ics')) || path === '/.well-known/caldav' || path === '/dav' || path.startsWith('/dav/');
}

/** Feed URL path for one area's blocks, or null for the blocks with no area. */
export function areaFeedPath(areaId: string | null): string {
  return areaId ? `/cal/area/${encodeURIComponent(areaId)}.ics` : `/cal/${OTHER}.ics`;
}

const ALLOW = 'OPTIONS, GET, HEAD, PROPFIND, REPORT';

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- request parsing ----------

export interface PropName {
  ns: string;
  name: string;
}

/**
 * The properties a PROPFIND or REPORT asks for: the direct children of its <prop>. Empty for
 * <allprop/> or no body. A tolerant scan, not a full XML parser: enough for what clients send.
 */
export function requestedProps(body: string): PropName[] | 'all' {
  if (!body.trim() || /<([\w.-]+:)?allprop\b/.test(body) || /<([\w.-]+:)?propname\b/.test(body)) return 'all';
  const prefixes = namespaces(body);
  const open = /<([\w.-]+:)?prop(\s[^>]*)?>/.exec(body);
  if (!open) return 'all';
  const out: PropName[] = [];
  const tag = /<(\/?)(?:([\w.-]+):)?([\w.-]+)([^>]*?)(\/?)>/g;
  tag.lastIndex = open.index + open[0].length;
  let depth = 0;
  for (let m = tag.exec(body); m; m = tag.exec(body)) {
    const [, closing, prefix, name, attrs, selfClosing] = m;
    if (closing) {
      if (depth === 0) break; // </prop>
      depth--;
      continue;
    }
    if (depth === 0) {
      const local = /xmlns="([^"]*)"/.exec(attrs)?.[1];
      out.push({ ns: local ?? prefixes.get(prefix ?? '') ?? '', name });
    }
    if (!selfClosing) depth++;
  }
  return out;
}

function namespaces(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of body.matchAll(/xmlns(?::([\w.-]+))?="([^"]*)"/g)) if (!map.has(m[1] ?? '')) map.set(m[1] ?? '', m[2]);
  return map;
}

/** The root element of a REPORT body, e.g. calendar-multiget. */
export function reportKind(body: string): string | null {
  const m = /<(?:[\w.-]+:)?([\w.-]+)[\s/>]/.exec(body.replace(/<\?xml[^>]*\?>/, '').trimStart());
  return m?.[1] ?? null;
}

function hrefs(body: string): string[] {
  return [...body.matchAll(/<(?:[\w.-]+:)?href>\s*([^<]+?)\s*<\/(?:[\w.-]+:)?href>/g)].map((m) => {
    try {
      return new URL(decodeXml(m[1]), 'http://x').pathname;
    } catch {
      return m[1];
    }
  });
}

const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** A calendar-query time-range, as comparable `YYYYMMDDTHHMMSS` stamps. */
function timeRange(body: string): { start?: string; end?: string } | null {
  const m = /<(?:[\w.-]+:)?time-range\b([^>]*)>/.exec(body);
  if (!m) return null;
  const at = (k: string) => new RegExp(`${k}="([0-9T]+)Z?"`).exec(m[1])?.[1];
  return { start: at('start'), end: at('end') };
}

// ---------- resources ----------

/** One calendar: an area's blocks, or the blocks with no area ("Other"). */
interface Cal {
  slug: string;
  areaId: string | null;
  name: string;
  color: CalColor;
}

type EventRes = { kind: 'event'; href: string; event: CalEvent; ics: string; etag: string };
type Resource = { kind: 'root' | 'principal' | 'home'; href: string } | { kind: 'calendar'; href: string; cal: Cal } | EventRes;

export function createCalendar(opts: CalendarOptions) {
  const name = opts.name.trim() || 'OpenThings';

  function calendars(): Cal[] {
    return [
      ...opts.areas().map((a) => ({ slug: `area-${a.id}`, areaId: a.id, name: `${name} · ${a.name}`, color: a.color })),
      { slug: OTHER, areaId: null, name: `${name} · Other`, color: { hex: NO_AREA.hex, css: NO_AREA.css } },
    ];
  }

  const calHref = (c: Cal) => `${HOME}${encodeURIComponent(c.slug)}/`;
  const eventHref = (c: Cal, e: CalEvent) => `${calHref(c)}${encodeURIComponent(e.uid.replace(/@openthings$/, ''))}.ics`;

  /** Per request: the calendars and their events, built once. */
  function snapshot() {
    const cals = calendars();
    const known = new Set(cals.map((c) => c.areaId));
    const all = opts.events();
    const events = new Map<string, EventRes[]>();
    for (const c of cals) {
      // A block whose area is gone (deleted on another device) shows under Other.
      const mine = all.filter((e) => (c.areaId ? e.areaId === c.areaId : !e.areaId || !known.has(e.areaId)));
      events.set(
        c.slug,
        mine.map((event) => {
          const ics = calendar([event], { name: c.name, timezone: opts.timezone, color: c.color });
          return { kind: 'event', href: eventHref(c, event), event, ics, etag: `"${etag(ics)}"` };
        }),
      );
    }
    return { cals, events, all };
  }
  type Snap = ReturnType<typeof snapshot>;

  function ctag(c: Cal, snap: Snap): string {
    return etag(c.name + c.color.hex + (snap.events.get(c.slug) ?? []).map((e) => e.href + e.etag).join('|'));
  }

  /** Inner XML of one property for a resource, or undefined when it doesn't have it. */
  function propValue(r: Resource, p: PropName, snap: Snap): string | undefined {
    const key = `${p.ns}|${p.name}`;
    const collection = r.kind !== 'event';
    switch (key) {
      case 'DAV:|resourcetype':
        if (r.kind === 'calendar') return '<d:collection/><c:calendar/>';
        if (r.kind === 'principal') return '<d:collection/><d:principal/>';
        return collection ? '<d:collection/>' : '';
      case 'DAV:|displayname':
        return xmlEscape(r.kind === 'calendar' ? r.cal.name : r.kind === 'event' ? r.event.summary : r.kind === 'principal' ? name : `${name} calendars`);
      case 'DAV:|current-user-principal':
      case 'DAV:|principal-URL':
      case 'DAV:|owner':
        return `<d:href>${PRINCIPAL}</d:href>`;
      case `${NS.c}|calendar-home-set`:
        return r.kind === 'root' || r.kind === 'principal' ? `<d:href>${HOME}</d:href>` : undefined;
      case `${NS.c}|calendar-user-address-set`:
        return r.kind === 'root' || r.kind === 'principal' ? '' : undefined;
      case 'DAV:|current-user-privilege-set':
        return '<d:privilege><d:read/></d:privilege><d:privilege><d:read-current-user-privilege-set/></d:privilege>';
      case 'DAV:|supported-report-set':
        return r.kind === 'calendar'
          ? '<d:supported-report><d:report><c:calendar-multiget/></d:report></d:supported-report><d:supported-report><d:report><c:calendar-query/></d:report></d:supported-report>'
          : undefined;
      case `${NS.c}|supported-calendar-component-set`:
        return r.kind === 'calendar' ? '<c:comp name="VEVENT"/>' : undefined;
      case `${NS.c}|calendar-description`:
        return r.kind === 'calendar' ? xmlEscape(r.cal.areaId ? `Time blocks for ${r.cal.name.slice(name.length + 3)} (read only)` : 'Time blocks with no area (read only)') : undefined;
      case `${NS.cs}|getctag`:
        return r.kind === 'calendar' ? ctag(r.cal, snap) : undefined;
      // Apple's calendar color, #RRGGBBAA: the area's color as the calendar's default.
      case `${NS.ic}|calendar-color`:
        return r.kind === 'calendar' ? `${r.cal.color.hex.toUpperCase()}FF` : undefined;
      case `${NS.ic}|calendar-order`:
        return r.kind === 'calendar' ? String(snap.cals.indexOf(r.cal) + 1) : undefined;
      case 'DAV:|getetag':
        return r.kind === 'event' ? xmlEscape(r.etag) : r.kind === 'calendar' ? `"${ctag(r.cal, snap)}"` : undefined;
      case 'DAV:|getcontenttype':
        return r.kind === 'event' ? 'text/calendar; charset=utf-8; component=vevent' : undefined;
      case 'DAV:|getcontentlength':
        return r.kind === 'event' ? String(new TextEncoder().encode(r.ics).length) : undefined;
      case `${NS.c}|calendar-data`:
        return r.kind === 'event' ? xmlEscape(r.ics) : undefined;
      default:
        return undefined;
    }
  }

  const ALL_PROPS: PropName[] = [
    { ns: 'DAV:', name: 'resourcetype' },
    { ns: 'DAV:', name: 'displayname' },
    { ns: 'DAV:', name: 'current-user-principal' },
    { ns: NS.c, name: 'calendar-home-set' },
    { ns: 'DAV:', name: 'supported-report-set' },
    { ns: NS.c, name: 'supported-calendar-component-set' },
    { ns: NS.cs, name: 'getctag' },
    { ns: NS.ic, name: 'calendar-color' },
    { ns: 'DAV:', name: 'getetag' },
    { ns: 'DAV:', name: 'getcontenttype' },
    { ns: 'DAV:', name: 'getcontentlength' },
  ];

  function response(r: Resource, wanted: PropName[] | 'all', snap: Snap): string {
    const list = wanted === 'all' ? ALL_PROPS : wanted;
    const found: string[] = [];
    const missing: string[] = [];
    list.forEach((p, i) => {
      const v = propValue(r, p, snap);
      const prefix = PREFIX[p.ns];
      if (v === undefined) {
        if (wanted !== 'all') missing.push(prefix ? `<${prefix}:${p.name}/>` : `<x${i}:${p.name} xmlns:x${i}="${xmlEscape(p.ns)}"/>`);
      } else {
        found.push(prefix ? `<${prefix}:${p.name}>${v}</${prefix}:${p.name}>` : `<x${i}:${p.name} xmlns:x${i}="${xmlEscape(p.ns)}">${v}</x${i}:${p.name}>`);
      }
    });
    const stat = (props: string[], status: string) => `<d:propstat><d:prop>${props.join('')}</d:prop><d:status>HTTP/1.1 ${status}</d:status></d:propstat>`;
    return `<d:response><d:href>${xmlEscape(r.href)}</d:href>${found.length ? stat(found, '200 OK') : ''}${missing.length ? stat(missing, '404 Not Found') : ''}</d:response>`;
  }

  function multistatus(responses: string[]): Response {
    const ns = Object.entries(NS).map(([p, u]) => ` xmlns:${p}="${u}"`).join('');
    const body = `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus${ns}>${responses.join('')}</d:multistatus>`;
    return new Response(body, { status: 207, headers: { 'content-type': 'application/xml; charset=utf-8', dav: '1, 3, calendar-access' } });
  }

  function ics(text: string, head: boolean, file: string): Response {
    return new Response(head ? null : text, {
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': `inline; filename="${file}"`,
        'cache-control': 'no-cache',
        etag: `"${etag(text)}"`,
      },
    });
  }

  /** The whole calendar, or one area's (or Other's) as its own calendar with its color. */
  function feed(cal: Cal | null, snap: Snap, head: boolean): Response {
    if (!cal) return ics(calendar(snap.all, { name, timezone: opts.timezone }), head, 'openthings.ics');
    const events = (snap.events.get(cal.slug) ?? []).map((e) => e.event);
    return ics(calendar(events, { name: cal.name, timezone: opts.timezone, color: cal.color }), head, `${cal.slug}.ics`);
  }

  const davHeaders = { dav: '1, 3, calendar-access', allow: ALLOW };
  const status = (code: number, text = '') => new Response(text, { status: code, headers: davHeaders });

  return async function handle(req: Request, url: URL): Promise<Response> {
    const path = url.pathname;
    const m = req.method;

    if (path.startsWith('/cal/')) {
      if (m !== 'GET' && m !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
      const snap = snapshot();
      if (path === FEED_PATH) return feed(null, snap, m === 'HEAD');
      const cal = snap.cals.find((c) => areaFeedPath(c.areaId) === path);
      return cal ? feed(cal, snap, m === 'HEAD') : new Response('Not found', { status: 404 });
    }
    if (path === '/.well-known/caldav') return new Response(null, { status: 301, headers: { location: ROOT } });

    // Collections answer with or without the trailing slash.
    const p = path.endsWith('.ics') || path.endsWith('/') ? path : `${path}/`;
    const snap = snapshot();

    let self: Resource | undefined;
    if (p === ROOT) self = { kind: 'root', href: ROOT };
    else if (p === PRINCIPAL) self = { kind: 'principal', href: PRINCIPAL };
    else if (p === HOME) self = { kind: 'home', href: HOME };
    else {
      const cal = snap.cals.find((c) => p === calHref(c) || (p.startsWith(calHref(c)) && p.endsWith('.ics')));
      if (cal && p === calHref(cal)) self = { kind: 'calendar', href: calHref(cal), cal };
      else if (cal) self = snap.events.get(cal.slug)?.find((e) => e.href === p);
    }
    if (!self) return status(404, 'Not found');

    if (m === 'OPTIONS') return new Response(null, { status: 200, headers: davHeaders });

    if (m === 'GET' || m === 'HEAD') {
      if (self.kind === 'event') {
        return new Response(m === 'HEAD' ? null : self.ics, { headers: { 'content-type': 'text/calendar; charset=utf-8', etag: self.etag } });
      }
      if (self.kind === 'calendar') return feed(self.cal, snap, m === 'HEAD');
      return new Response(m === 'HEAD' ? null : `${name}: CalDAV calendars of time blocks. Add ${url.origin}${ROOT} as a CalDAV account, or subscribe to ${url.origin}${FEED_PATH}.\n`, {
        headers: { 'content-type': 'text/plain; charset=utf-8', ...davHeaders },
      });
    }

    if (m === 'PROPFIND') {
      const wanted = requestedProps(await req.text());
      const depth = req.headers.get('depth') ?? 'infinity';
      const list: Resource[] = [self];
      if (depth !== '0') {
        if (self.kind === 'root') list.push({ kind: 'principal', href: PRINCIPAL }, { kind: 'home', href: HOME });
        if (self.kind === 'home') list.push(...snap.cals.map((cal) => ({ kind: 'calendar' as const, href: calHref(cal), cal })));
        if (self.kind === 'calendar') list.push(...(snap.events.get(self.cal.slug) ?? []));
      }
      return multistatus(list.map((r) => response(r, wanted, snap)));
    }

    if (m === 'REPORT') {
      if (self.kind !== 'calendar') return status(403, 'REPORT works on a calendar');
      const body = await req.text();
      const kind = reportKind(body);
      const wanted = requestedProps(body);
      const props = wanted === 'all' ? [{ ns: 'DAV:', name: 'getetag' }, { ns: NS.c, name: 'calendar-data' }] : wanted;
      const mine = snap.events.get(self.cal.slug) ?? [];
      if (kind === 'calendar-multiget') {
        const byHref = new Map(mine.map((e) => [e.href, e]));
        const out = hrefs(body).map((h) => {
          const e = byHref.get(h);
          return e ? response(e, props, snap) : `<d:response><d:href>${xmlEscape(h)}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`;
        });
        return multistatus(out);
      }
      if (kind === 'calendar-query') {
        const range = timeRange(body);
        const stamp = (s: string) => s.replace(/[-:]/g, '').padEnd(15, '0');
        const hits = mine.filter((e) => !range || ((!range.end || stamp(e.event.start) < range.end) && (!range.start || stamp(e.event.end) > range.start)));
        return multistatus(hits.map((e) => response(e, props, snap)));
      }
      return new Response('<?xml version="1.0" encoding="utf-8"?>\n<d:error xmlns:d="DAV:"><d:supported-report/></d:error>', {
        status: 403,
        headers: { 'content-type': 'application/xml; charset=utf-8', ...davHeaders },
      });
    }

    if (['PUT', 'DELETE', 'PROPPATCH', 'MKCALENDAR', 'MKCOL', 'MOVE', 'COPY', 'POST'].includes(m)) {
      return status(403, 'These calendars are read only: edit time blocks in OpenThings.');
    }
    return status(405, 'Method not allowed');
  };
}
