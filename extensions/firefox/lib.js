// Pure helpers shared by the popup, the options page and the tests. No browser APIs here.

/** @typedef {'inbox' | 'dump'} Target */
/** @typedef {{ mode: 'app' | 'server', serverUrl: string, target: Target, includePage: boolean, dump: boolean }} Settings */

/** @type {Settings} */
// `dump` mirrors the app's Settings → Features → Brain Dump (src/lib/features.svelte.ts): on by default.
// The app keeps it per device in localStorage, so the extension can't read it and has its own switch.
export const DEFAULTS = { mode: 'app', serverUrl: '', target: 'inbox', includePage: false, dump: true };

/** Merge stored values over the defaults, ignoring junk. */
export function normalizeSettings(raw) {
  const s = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  return {
    mode: s.mode === 'server' ? 'server' : 'app',
    serverUrl: normalizeServerUrl(String(s.serverUrl ?? '')),
    dump: s.dump !== false,
    // With Brain Dump off, everything goes to the Inbox.
    target: s.target === 'dump' && s.dump !== false ? 'dump' : 'inbox',
    includePage: s.includePage === true,
  };
}

/** "openthings.example.ts.net/" → "https://openthings.example.ts.net"; "" if it isn't a usable URL. */
export function normalizeServerUrl(input) {
  let s = input.trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/** Notes for the page the popup was opened on: "Title\nURL" (only http(s) pages). */
export function pageNotes(tab) {
  if (!tab || !/^https?:\/\//i.test(tab.url ?? '')) return '';
  return tab.title && tab.title !== tab.url ? `${tab.title}\n${tab.url}` : tab.url;
}

/**
 * The openthings:// link that adds the to-do (docs/url-scheme.md).
 * Inbox: the text goes in `text`, so quick-add syntax (@fri, #tag, +Project) works and places it.
 * Brain Dump: quick add there is plain text, so it goes in `title`, with `text=@dump` to place it.
 */
export function addLink({ text, notes = '', target = 'inbox', save = true }) {
  const q = new URLSearchParams();
  const t = text.trim();
  if (target === 'dump') {
    q.set('title', t);
    q.set('text', '@dump');
  } else {
    q.set('text', t);
  }
  if (notes.trim()) q.set('notes', notes.trim());
  if (save) q.set('save', '1');
  // URLSearchParams writes spaces as "+"; the app decodes with URLSearchParams too, but %20 is what the docs show.
  return `openthings://add?${q.toString().replace(/\+/g, '%20')}`;
}

/** The link that brings the app up: the main window on desktop, or the list on a phone. */
export function openLink(target = 'inbox', dumpEnabled = true) {
  return target === 'dump' && dumpEnabled ? 'openthings://dump' : 'openthings://show';
}

/** POST /api/v1/tasks request for server mode (docs/api.md). */
export function serverRequest(serverUrl, { text, notes = '', target = 'inbox' }) {
  const t = text.trim();
  const body = target === 'dump' ? { title: t, dump: true } : { text: t };
  if (notes.trim()) body.notes = notes.trim();
  return {
    url: `${serverUrl}/api/v1/tasks`,
    init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  };
}

/** The server's error text for a failed request, with a hint for the usual origin refusal. */
export function serverError(status, body, origin) {
  const msg = body && typeof body.error === 'string' ? body.error : `HTTP ${status}`;
  if (status === 403 && /origin/i.test(msg)) return `${msg}. Add ${origin} to OPENTHINGS_ALLOWED_ORIGINS on the server.`;
  return msg;
}
