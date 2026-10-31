/**
 * Calendar subscriptions for time blocks (#99): an iCalendar feed and a read-only CalDAV calendar,
 * so Apple Calendar, Google Calendar, Outlook, Thunderbird or DAVx5 can show them.
 *
 *   GET  /cal/openthings.ics       the whole calendar (subscribe with webcal://…)
 *   GET  /.well-known/caldav       → /dav/ (CalDAV discovery, RFC 6764)
 *   /dav/                          principal, calendar home /dav/calendars/, calendar /dav/calendars/openthings/
 *
 * Read only: OpenThings stays the place blocks are edited, so PUT, DELETE and PROPPATCH are refused.
 * CalDAV support is the subset clients need: PROPFIND (depth 0 / 1), REPORT calendar-multiget and
 * calendar-query (with time-range), GET of one event. Change detection uses ETags and getctag.
 *
 * Written from scratch for this project (RFC 4918, RFC 4791).
 */
import { calendar, etag, type CalEvent } from '../src/lib/ical';

export interface CalendarOptions {
  /** Shown in subscribers' calendar lists. Default "OpenThings". */
  name: string;
  /** IANA zone the floating times belong to, e.g. America/Denver. */
  timezone?: string;
  events: () => CalEvent[];
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
const CAL = '/dav/calendars/openthings/';

export function isCalendarPath(path: string): boolean {
  return path === FEED_PATH || path === '/.well-known/caldav' || path === '/dav' || path.startsWith('/dav/');
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

type Resource =
  | { kind: 'root' | 'principal' | 'home'; href: string }
  | { kind: 'calendar'; href: string }
  | { kind: 'event'; href: string; event: CalEvent; ics: string; etag: string };

export function eventHref(e: CalEvent): string {
  return `${CAL}${encodeURIComponent(e.uid.replace(/@openthings$/, ''))}.ics`;
}

export function createCalendar(opts: CalendarOptions) {
  const name = opts.name.trim() || 'OpenThings';

  function eventResources(): Extract<Resource, { kind: 'event' }>[] {
    return opts.events().map((event) => {
      const ics = calendar([event], { name, timezone: opts.timezone });
      return { kind: 'event', href: eventHref(event), event, ics, etag: `"${etag(ics)}"` };
    });
  }

  function ctag(events: Extract<Resource, { kind: 'event' }>[]): string {
    return etag(name + events.map((e) => e.href + e.etag).join('|'));
  }

  /** Inner XML of one property for a resource, or undefined when it doesn't have it. */
  function propValue(r: Resource, p: PropName, events: () => Extract<Resource, { kind: 'event' }>[]): string | undefined {
    const key = `${p.ns}|${p.name}`;
    const collection = r.kind !== 'event';
    switch (key) {
      case 'DAV:|resourcetype':
        if (r.kind === 'calendar') return '<d:collection/><c:calendar/>';
        if (r.kind === 'principal') return '<d:collection/><d:principal/>';
        return collection ? '<d:collection/>' : '';
      case 'DAV:|displayname':
        return xmlEscape(r.kind === 'calendar' ? name : r.kind === 'event' ? r.event.summary : r.kind === 'principal' ? 'OpenThings' : 'OpenThings calendars');
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
        return r.kind === 'calendar' ? 'Time blocks from OpenThings (read only)' : undefined;
      case `${NS.c}|calendar-timezone`:
        return undefined;
      case `${NS.cs}|getctag`:
        return r.kind === 'calendar' ? ctag(events()) : undefined;
      case `${NS.ic}|calendar-color`:
        return r.kind === 'calendar' ? '#5A78D1FF' : undefined;
      case 'DAV:|getetag':
        return r.kind === 'event' ? xmlEscape(r.etag) : r.kind === 'calendar' ? `"${ctag(events())}"` : undefined;
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
    { ns: 'DAV:', name: 'getetag' },
    { ns: 'DAV:', name: 'getcontenttype' },
    { ns: 'DAV:', name: 'getcontentlength' },
  ];

  function response(r: Resource, wanted: PropName[] | 'all', events: () => Extract<Resource, { kind: 'event' }>[]): string {
    const list = wanted === 'all' ? ALL_PROPS : wanted;
    const found: string[] = [];
    const missing: string[] = [];
    list.forEach((p, i) => {
      const v = propValue(r, p, events);
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

  function feed(head: boolean): Response {
    const ics = calendar(opts.events(), { name, timezone: opts.timezone });
    return new Response(head ? null : ics, {
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'inline; filename="openthings.ics"',
        'cache-control': 'no-cache',
        etag: `"${etag(ics)}"`,
      },
    });
  }

  const davHeaders = { dav: '1, 3, calendar-access', allow: ALLOW };
  const status = (code: number, text = '') => new Response(text, { status: code, headers: davHeaders });

  return async function handle(req: Request, url: URL): Promise<Response> {
    const path = url.pathname;
    const m = req.method;

    if (path === FEED_PATH) {
      if (m !== 'GET' && m !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
      return feed(m === 'HEAD');
    }
    if (path === '/.well-known/caldav') return new Response(null, { status: 301, headers: { location: ROOT } });

    // Collections answer with or without the trailing slash.
    const p = path.endsWith('.ics') || path.endsWith('/') ? path : `${path}/`;
    let events: Extract<Resource, { kind: 'event' }>[] | null = null;
    const allEvents = () => (events ??= eventResources());

    let self: Resource | undefined;
    if (p === ROOT) self = { kind: 'root', href: ROOT };
    else if (p === PRINCIPAL) self = { kind: 'principal', href: PRINCIPAL };
    else if (p === HOME) self = { kind: 'home', href: HOME };
    else if (p === CAL) self = { kind: 'calendar', href: CAL };
    else if (p.startsWith(CAL) && p.endsWith('.ics')) self = allEvents().find((e) => e.href === p);
    if (!self) return status(404, 'Not found');

    if (m === 'OPTIONS') return new Response(null, { status: 200, headers: davHeaders });

    if (m === 'GET' || m === 'HEAD') {
      if (self.kind === 'event') {
        return new Response(m === 'HEAD' ? null : self.ics, { headers: { 'content-type': 'text/calendar; charset=utf-8', etag: self.etag } });
      }
      if (self.kind === 'calendar') return feed(m === 'HEAD');
      return new Response(m === 'HEAD' ? null : `${name}: a CalDAV calendar. Add ${url.origin}${ROOT} as a CalDAV account, or subscribe to ${url.origin}${FEED_PATH}.\n`, {
        headers: { 'content-type': 'text/plain; charset=utf-8', ...davHeaders },
      });
    }

    if (m === 'PROPFIND') {
      const wanted = requestedProps(await req.text());
      const depth = req.headers.get('depth') ?? 'infinity';
      const list: Resource[] = [self];
      if (depth !== '0') {
        if (self.kind === 'root') list.push({ kind: 'principal', href: PRINCIPAL }, { kind: 'home', href: HOME });
        if (self.kind === 'home') list.push({ kind: 'calendar', href: CAL });
        if (self.kind === 'calendar') list.push(...allEvents());
      }
      return multistatus(list.map((r) => response(r, wanted, allEvents)));
    }

    if (m === 'REPORT') {
      const body = await req.text();
      const kind = reportKind(body);
      const wanted = requestedProps(body);
      const props = wanted === 'all' ? [{ ns: 'DAV:', name: 'getetag' }, { ns: NS.c, name: 'calendar-data' }] : wanted;
      if (kind === 'calendar-multiget') {
        const want = hrefs(body);
        const byHref = new Map(allEvents().map((e) => [e.href, e]));
        const out = want.map((h) => {
          const e = byHref.get(h);
          return e ? response(e, props, allEvents) : `<d:response><d:href>${xmlEscape(h)}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`;
        });
        return multistatus(out);
      }
      if (kind === 'calendar-query') {
        const range = timeRange(body);
        const stamp = (s: string) => s.replace(/[-:]/g, '').padEnd(15, '0');
        const hits = allEvents().filter((e) => !range || ((!range.end || stamp(e.event.start) < range.end) && (!range.start || stamp(e.event.end) > range.start)));
        return multistatus(hits.map((e) => response(e, props, allEvents)));
      }
      return new Response('<?xml version="1.0" encoding="utf-8"?>\n<d:error xmlns:d="DAV:"><d:supported-report/></d:error>', {
        status: 403,
        headers: { 'content-type': 'application/xml; charset=utf-8', ...davHeaders },
      });
    }

    if (['PUT', 'DELETE', 'PROPPATCH', 'MKCALENDAR', 'MKCOL', 'MOVE', 'COPY', 'POST'].includes(m)) {
      return status(403, 'This calendar is read only: edit time blocks in OpenThings.');
    }
    return status(405, 'Method not allowed');
  };
}
