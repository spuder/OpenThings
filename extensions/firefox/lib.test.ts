import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module without types
import { addedLabel, addLink, normalizeServerUrl, normalizeSettings, openLink, pageNotes, serverError, serverRequest } from './lib.js';
import { addLinkParsed, parseRoute } from '../../src/lib/native/snapshot';

const day = '2026-10-29';
const parse = (link: string) => {
  const r = parseRoute(link);
  if (r?.kind !== 'add') throw new Error(`not an add link: ${link}`);
  return { r, p: addLinkParsed(r, day) };
};

describe('addLink', () => {
  it('sends Inbox text as quick add so the syntax places it', () => {
    const link = addLink({ text: 'Buy milk #shop @fri +House' });
    expect(link).toBe('openthings://add?text=Buy%20milk%20%23shop%20%40fri%20%2BHouse&save=1');
    const { r, p } = parse(link);
    expect(r.save).toBe(true);
    expect(p.title).toBe('Buy milk');
    expect(p.tags).toEqual(['shop']);
    expect(p.project).toBe('House');
    expect(p.dump).toBe(false);
  });

  it('plain Inbox text stays in the Inbox', () => {
    const { p } = parse(addLink({ text: 'Call mom' }));
    expect(p.title).toBe('Call mom');
    expect(p.dump).toBe(false);
    expect(p.project).toBeNull();
  });

  it('puts Brain Dump text in the title, unparsed, with @dump to place it', () => {
    const { p } = parse(addLink({ text: 'idea: #1 @ the café & more', target: 'dump' }));
    expect(p.dump).toBe(true);
    expect(p.title).toBe('idea: #1 @ the café & more');
    expect(p.tags).toEqual([]);
  });

  it('adds notes and can leave save off to open quick add instead', () => {
    const { r, p } = parse(addLink({ text: 'Read', notes: 'Title\nhttps://x.test/a?b=1&c=2', save: false }));
    expect(r.save).toBe(false);
    expect(p.notes).toBe('Title\nhttps://x.test/a?b=1&c=2');
  });

  it('open links', () => {
    expect(openLink()).toBe('openthings://show');
    expect(openLink('dump')).toBe('openthings://dump');
    expect(parseRoute(openLink('dump'))).toEqual({ kind: 'view', view: 'dump' });
  });
});

describe('server mode', () => {
  it('builds the REST request', () => {
    const inbox = serverRequest('https://ot.test', { text: 'Pay rent @1st' });
    expect(inbox.url).toBe('https://ot.test/api/v1/tasks');
    expect(JSON.parse(inbox.init.body)).toEqual({ text: 'Pay rent @1st' });
    const dump = serverRequest('https://ot.test', { text: ' thought ', notes: 'n', target: 'dump' });
    expect(JSON.parse(dump.init.body)).toEqual({ title: 'thought', dump: true, notes: 'n' });
  });

  it('normalizes server URLs', () => {
    expect(normalizeServerUrl('openthings.tail.ts.net/')).toBe('https://openthings.tail.ts.net');
    expect(normalizeServerUrl('http://localhost:8080//')).toBe('http://localhost:8080');
    expect(normalizeServerUrl('https://h.test/ot/')).toBe('https://h.test/ot');
    expect(normalizeServerUrl('ftp://x')).toBe('');
    expect(normalizeServerUrl('  ')).toBe('');
  });

  it('explains an origin refusal', () => {
    expect(serverError(403, { error: 'Origin moz-extension://abc is not allowed (set OPENTHINGS_ALLOWED_ORIGINS)' }, 'moz-extension://abc')).toMatch(/Add moz-extension:\/\/abc to OPENTHINGS_ALLOWED_ORIGINS/);
    expect(serverError(500, null, 'x')).toBe('HTTP 500');
  });
});

describe('settings and page notes', () => {
  it('falls back to defaults', () => {
    expect(normalizeSettings({ mode: 'weird', target: 'dump', serverUrl: 'h.test' })).toEqual({ mode: 'app', serverUrl: 'https://h.test', target: 'dump', includePage: false, dump: true });
    expect(normalizeSettings(null).mode).toBe('app');
  });
  it('page notes only for web pages', () => {
    expect(pageNotes({ url: 'https://a.test/', title: 'A' })).toBe('A\nhttps://a.test/');
    expect(pageNotes({ url: 'about:newtab', title: 'New Tab' })).toBe('');
  });
});

describe('Brain Dump switch', () => {
  it('is on by default, like the app', async () => {
    const { FEATURES } = await import('../../src/lib/features.svelte');
    expect(normalizeSettings({}).dump).toBe(FEATURES.find((f: { id: string }) => f.id === 'dump')?.default);
    expect(normalizeSettings({}).dump).toBe(true);
  });
  it('off sends everything to the Inbox', () => {
    const s = normalizeSettings({ dump: false, target: 'dump' });
    expect(s).toMatchObject({ dump: false, target: 'inbox' });
    expect(parseRoute(addLink({ text: 'x', target: s.target }))).toMatchObject({ text: 'x' });
  });
  it('off never opens the Brain Dump', () => {
    expect(openLink('dump', false)).toBe('openthings://show');
    expect(openLink('dump', true)).toBe('openthings://dump');
  });
});

describe('handoff', () => {
  it('sends silently from the background once links are allowed', async () => {
    // @ts-expect-error plain JS module without types
    const { handoffPlan } = await import('./lib.js');
    for (const tabUrl of ['https://example.com', 'about:newtab', undefined]) expect(handoffPlan({ granted: true, tabUrl })).toEqual(['background']);
  });
  it('before that, uses the web page tab, or the helper page where extensions cannot navigate', async () => {
    // @ts-expect-error plain JS module without types
    const { handoffPlan, privilegedPage } = await import('./lib.js');
    expect(handoffPlan({ tabUrl: 'https://example.com/a' })).toEqual(['tab', 'helper']);
    expect(handoffPlan({ tabUrl: 'http://localhost:8080/' })).toEqual(['tab', 'helper']);
    // Unknown URL (no tab access): try the tab first, fall back to the helper.
    expect(handoffPlan({})).toEqual(['tab', 'helper']);
    for (const u of ['about:newtab', 'about:home', 'about:debugging', 'moz-extension://x/options.html', 'file:///tmp/a']) {
      expect(privilegedPage(u)).toBe(true);
      expect(handoffPlan({ tabUrl: u })).toEqual(['helper']);
    }
  });
  it('helper page link and the openthings:// only check', async () => {
    // @ts-expect-error plain JS module without types
    const { handoffPage, isOpenThingsLink } = await import('./lib.js');
    const link = addLink({ text: 'Buy milk #shop', target: 'dump' });
    const page = handoffPage(link);
    expect(page.startsWith('handoff.html?to=')).toBe(true);
    expect(new URLSearchParams(page.split('?')[1]).get('to')).toBe(link);
    expect(isOpenThingsLink(link)).toBe(true);
    expect(isOpenThingsLink('javascript:alert(1)')).toBe(false);
    expect(isOpenThingsLink('https://evil.test')).toBe(false);
  });
});

describe('addedLabel', () => {
  it('names the destination', () => {
    expect(addedLabel('dump')).toBe('✓ Added to Brain Dump');
    expect(addedLabel('inbox')).toBe('✓ Added to Inbox');
  });
});
