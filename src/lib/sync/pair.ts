/**
 * Phone pairing (#43). The desktop and web apps show a QR code holding `pairLink(server)`; the
 * iOS app scans it (Settings → Sync → Scan QR code), or the Camera app opens the link, and the
 * server URL fills in. No secrets: sync has no auth yet (docs/sync.md).
 */

/** A server address as typed: adds https:// when no scheme is given and drops trailing slashes. */
export function normalizeUrl(input: string): string {
  let u = input.trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, '');
}

export function pairLink(server: string): string {
  return `openthings://pair?server=${encodeURIComponent(server)}`;
}

/** The server URL in a scanned code: a pairing link, or a plain http(s) URL. Null if it's neither. */
export function parsePairCode(text: string): string | null {
  const t = text.trim();
  const link = /^openthings:\/\/pair\/?(?:\?([^#]*))?/i.exec(t);
  const candidate = link ? new URLSearchParams(link[1] ?? '').get('server') : /^https?:\/\//i.test(t) ? t : null;
  if (!candidate) return null;
  const u = normalizeUrl(candidate);
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

/** True for addresses that only mean "this computer", which a phone can't reach. */
export function isLoopback(server: string): boolean {
  try {
    const h = new URL(server).hostname.replace(/^\[|\]$/g, '');
    return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '0.0.0.0' || /^127\./.test(h);
  } catch {
    return false;
  }
}
