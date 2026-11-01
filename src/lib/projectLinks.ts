/**
 * Project links (#130): references attached to a project, such as a repo, an issue tracker,
 * a path on disk, an editor link or an AI conversation. Only the reference is stored, never a file.
 */
import * as db from './db';
import type { ID, ProjectLink } from './types';

export type LinkType = 'github' | 'gitlab' | 'file' | 'editor' | 'obsidian' | 'youtube' | 'chatgpt' | 'claude' | 'grok' | 'app' | 'web';

/** Readable name for each type, shown as the default label and in tooltips. */
export const LINK_TYPE_NAMES: Record<LinkType, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  file: 'Path',
  editor: 'Editor',
  obsidian: 'Obsidian',
  youtube: 'YouTube',
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  grok: 'Grok',
  app: 'App link',
  web: 'Link',
};

const hostIs = (host: string, ...domains: string[]) => domains.some((d) => host === d || host.endsWith(`.${d}`));

/** A local path: /abs, ~/home, C:\ or C:/, \\server\share or file://. */
export function isPath(s: string): boolean {
  return /^(~(\/|$)|\/(?!\/)|[a-zA-Z]:[\\/]|\\\\[^\\]+\\)/.test(s) || /^file:/i.test(s);
}

/** Work out a link's type from its URL or scheme. */
export function detectLinkType(raw: string): LinkType {
  const s = raw.trim();
  if (isPath(s)) return 'file';
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s)?.[1]?.toLowerCase();
  if (!scheme) return 'web';
  if (scheme === 'vscode' || scheme === 'vscode-insiders' || scheme === 'cursor' || scheme === 'zed' || scheme === 'idea') return 'editor';
  if (scheme === 'obsidian') return 'obsidian';
  if (scheme !== 'http' && scheme !== 'https') return 'app';
  let host = '';
  try {
    host = new URL(s).hostname.toLowerCase();
  } catch {
    return 'web';
  }
  if (hostIs(host, 'github.com')) return 'github';
  if (hostIs(host, 'gitlab.com') || host.startsWith('gitlab.')) return 'gitlab';
  if (hostIs(host, 'youtube.com', 'youtu.be')) return 'youtube';
  if (hostIs(host, 'chatgpt.com', 'chat.openai.com')) return 'chatgpt';
  if (hostIs(host, 'claude.ai')) return 'claude';
  if (hostIs(host, 'grok.com') || (hostIs(host, 'x.com') && /^https?:\/\/[^/]+\/i\/grok/i.test(s))) return 'grok';
  return 'web';
}

/**
 * Clean up what was typed, or return null if it isn't a usable link. Accepts a URL with a scheme,
 * a local path, or a bare domain like "github.com/a/b", which becomes https://.
 */
export function normalizeLink(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 2048) return null;
  // Paths may contain spaces; URLs may not.
  if (isPath(s)) return s;
  if (/\s/.test(s)) return null;
  // A scheme ("x:") but not a bare host:port such as localhost:3000.
  const m = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(s);
  if (m && !/^\d+(\/|$)/.test(m[2])) {
    const scheme = m[1].toLowerCase();
    if (scheme === 'javascript' || scheme === 'data' || scheme === 'vbscript') return null;
    if (scheme === 'http' || scheme === 'https') {
      try {
        return new URL(s).hostname ? s : null;
      } catch {
        return null;
      }
    }
    return m[2] ? s : null;
  }
  // Bare domain: needs a dot in the host part.
  if (!/^[^/\s]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(s) && !/^localhost(:\d+)?(\/|$)/i.test(s)) return null;
  try {
    new URL(`https://${s}`);
    return `https://${s}`;
  } catch {
    return null;
  }
}

/**
 * The href to render for a link, or null when it shouldn't be a plain link: local paths (browsers
 * won't open file:// from a web page) and anything normalizeLink rejects. Links that arrive by sync
 * never went through normalizeLink, so this check runs again at render time.
 */
export function safeHref(url: string): string | null {
  if (isPath(url.trim())) return null;
  return normalizeLink(url) === url ? url : null;
}

/** The text to show for a link: its label, or a short form of the URL. */
export function linkTitle(l: Pick<ProjectLink, 'label' | 'url'>): string {
  if (l.label.trim()) return l.label.trim();
  const u = l.url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
  return u.length > 48 ? `${u.slice(0, 47)}…` : u;
}

// ---------- database ----------

export function listLinks(projectId: ID): ProjectLink[] {
  return db.all<ProjectLink>('SELECT * FROM project_links WHERE project_id = ? ORDER BY sort, id', [projectId]);
}

/** Add a link at the end of the project's list. Returns the new row, or null if the URL is invalid. */
export function addLink(projectId: ID, url: string, label = ''): ProjectLink | null {
  const clean = normalizeLink(url);
  if (!clean) return null;
  const last = db.one<{ m: number | null }>('SELECT MAX(sort) AS m FROM project_links WHERE project_id = ?', [projectId])?.m;
  const row: ProjectLink = {
    id: db.uuid7(),
    project_id: projectId,
    type: detectLinkType(clean),
    label: label.trim(),
    url: clean,
    sort: (last ?? 0) + 1,
    created_at: new Date().toISOString(),
  };
  db.insert('project_links', { ...row });
  return row;
}

/** Change a link's label or URL. The type is re-detected when the URL changes. Returns false if invalid. */
export function updateLink(id: ID, fields: { label?: string; url?: string }): boolean {
  const patch: Record<string, string> = {};
  if (fields.label !== undefined) patch.label = fields.label.trim();
  if (fields.url !== undefined) {
    const clean = normalizeLink(fields.url);
    if (!clean) return false;
    patch.url = clean;
    patch.type = detectLinkType(clean);
  }
  db.update('project_links', id, patch);
  return true;
}

export function removeLink(id: ID) {
  db.remove('project_links', id);
}

/** Move a link one place up or down within its project. */
export function moveLink(id: ID, dir: -1 | 1): boolean {
  const l = db.one<ProjectLink>('SELECT * FROM project_links WHERE id = ?', [id]);
  if (!l) return false;
  const list = listLinks(l.project_id);
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (j < 0 || j >= list.length) return false;
  const other = list[j];
  // Swap sorts; if they're equal (e.g. two devices added at once) spread them apart first.
  const [a, b] = l.sort === other.sort ? [other.sort + dir * 0.5, other.sort] : [other.sort, l.sort];
  db.update('project_links', l.id, { sort: a });
  db.update('project_links', other.id, { sort: b });
  return true;
}
