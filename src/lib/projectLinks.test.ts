import { beforeEach, describe, expect, it } from 'vitest';
import * as db from './db';
import { addLink, detectLinkType, linkTitle, listLinks, moveLink, normalizeLink, removeLink, safeHref, updateLink } from './projectLinks';

describe('detectLinkType', () => {
  it.each([
    ['https://github.com/spuder/OpenThings', 'github'],
    ['https://github.com/spuder/OpenThings/issues/130', 'github'],
    ['https://gitlab.com/a/b/-/issues/1', 'gitlab'],
    ['https://gitlab.example.org/a/b', 'gitlab'],
    ['~/code/openthings', 'file'],
    ['/Users/spencer/Projects', 'file'],
    ['C:\\Users\\me\\Documents', 'file'],
    ['\\\\nas\\share\\truck', 'file'],
    ['file:///home/me/notes.md', 'file'],
    ['vscode://file/home/me/code', 'editor'],
    ['cursor://file/home/me/code', 'editor'],
    ['obsidian://open?vault=Home&file=Truck', 'obsidian'],
    ['https://www.youtube.com/watch?v=abc', 'youtube'],
    ['https://youtu.be/abc', 'youtube'],
    ['https://chatgpt.com/c/123', 'chatgpt'],
    ['https://chat.openai.com/share/123', 'chatgpt'],
    ['https://claude.ai/chat/123', 'claude'],
    ['https://grok.com/chat/123', 'grok'],
    ['https://x.com/i/grok?conversation=1', 'grok'],
    ['x-devonthink-item://ABC', 'app'],
    ['https://example.com/page', 'web'],
    ['https://notgithub.com/x', 'web'],
  ])('%s → %s', (url, type) => expect(detectLinkType(url)).toBe(type));
});

describe('normalizeLink', () => {
  it('accepts URLs, paths and app schemes', () => {
    expect(normalizeLink(' https://github.com/a/b ')).toBe('https://github.com/a/b');
    expect(normalizeLink('~/My Projects/truck')).toBe('~/My Projects/truck');
    expect(normalizeLink('vscode://file/x')).toBe('vscode://file/x');
  });
  it('adds https:// to a bare domain', () => {
    expect(normalizeLink('github.com/a/b')).toBe('https://github.com/a/b');
    expect(normalizeLink('localhost:3000/x')).toBe('https://localhost:3000/x');
  });
  it('rejects empty, unsafe or malformed input', () => {
    for (const bad of ['', '   ', 'hello world', 'notalink', 'javascript:alert(1)', 'data:text/html,x', 'https://', 'mailto:']) {
      expect(normalizeLink(bad), bad).toBeNull();
    }
  });
});

describe('safeHref', () => {
  it('keeps web and app links, not paths or unsafe links that arrived by sync', () => {
    expect(safeHref('https://github.com/a/b')).toBe('https://github.com/a/b');
    expect(safeHref('vscode://file/x')).toBe('vscode://file/x');
    for (const u of ['~/code/x', '/Users/me', 'file:///home/me/a.md', 'javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', 'not a link']) {
      expect(safeHref(u), u).toBeNull();
    }
  });
});

describe('linkTitle', () => {
  it('uses the label, or a short URL', () => {
    expect(linkTitle({ label: ' Repo ', url: 'https://github.com/a/b' })).toBe('Repo');
    expect(linkTitle({ label: '', url: 'https://www.github.com/a/b/' })).toBe('github.com/a/b');
  });
});

describe('project link CRUD', () => {
  beforeEach(async () => {
    await db.openDb({ memory: true });
  });

  it('adds links in order with a detected type, and records sync ops', () => {
    const before = db.opCount();
    const a = addLink('p1', 'https://github.com/a/b', 'Repo')!;
    const b = addLink('p1', '~/code/b')!;
    addLink('p2', 'https://example.com');
    expect(a.type).toBe('github');
    expect(b.type).toBe('file');
    expect(listLinks('p1').map((l) => l.id)).toEqual([a.id, b.id]);
    expect(b.sort).toBeGreaterThan(a.sort);
    expect(db.opCount()).toBe(before + 3);
    expect(db.pendingOps().filter((o) => o.tbl === 'project_links' && o.kind === 'insert')).toHaveLength(3);
  });

  it('refuses an invalid URL', () => {
    expect(addLink('p1', 'not a link')).toBeNull();
    expect(listLinks('p1')).toEqual([]);
  });

  it('updates the label and re-detects the type when the URL changes', () => {
    const a = addLink('p1', 'https://example.com')!;
    expect(updateLink(a.id, { url: 'https://claude.ai/chat/1', label: 'Plan' })).toBe(true);
    expect(listLinks('p1')[0]).toMatchObject({ type: 'claude', label: 'Plan', url: 'https://claude.ai/chat/1' });
    expect(updateLink(a.id, { url: 'bad url' })).toBe(false);
  });

  it('reorders within a project and keeps the order', () => {
    const a = addLink('p1', 'https://a.com')!;
    const b = addLink('p1', 'https://b.com')!;
    const c = addLink('p1', 'https://c.com')!;
    expect(moveLink(c.id, -1)).toBe(true);
    expect(listLinks('p1').map((l) => l.id)).toEqual([a.id, c.id, b.id]);
    expect(moveLink(a.id, -1)).toBe(false);
    expect(moveLink(b.id, 1)).toBe(false);
  });

  it('removes a link and records a delete op', () => {
    const a = addLink('p1', 'https://a.com')!;
    removeLink(a.id);
    expect(listLinks('p1')).toEqual([]);
    expect(db.pendingOps().some((o) => o.tbl === 'project_links' && o.kind === 'delete' && o.row_id === a.id)).toBe(true);
  });

  it('applies links that arrive from another device', () => {
    const n = db.applyRemoteOps([
      { hlc: `${String(Date.now()).padStart(15, '0')}:00000:otherdevice1`, device: 'otherdevice1', tbl: 'project_links', row_id: 'l1', kind: 'insert',
        payload: { id: 'l1', project_id: 'p1', type: 'grok', label: '', url: 'https://grok.com/c/1', sort: 1, created_at: '2026-01-01T00:00:00Z' } },
    ]);
    expect(n).toBe(1);
    expect(listLinks('p1')[0].url).toBe('https://grok.com/c/1');
  });
});
