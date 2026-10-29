/**
 * The Omarchy desktop theme, read from its colors.toml (the desktop app sends it; see
 * src-tauri/src/omarchy.rs). Works for themes we don't bundle too, since only the file is needed.
 */
import { omarchyThemes, type OmarchyPalette } from './omarchy-themes';

type Key = Exclude<keyof OmarchyPalette, 'id' | 'name' | 'mode'>;
const KEYS: Key[] = ['accent', 'selection', 'muted', 'background', 'dark_background', 'darker_background', 'lighter_background', 'foreground', 'dark_foreground', 'light_foreground', 'bright_foreground', 'red', 'yellow', 'orange', 'green', 'cyan', 'blue', 'magenta', 'brown'];

/** "tokyo-night" -> "Tokyo Night", or the bundled theme's own name. */
export function omarchyName(id: string): string {
  return omarchyThemes.find((t) => t.id === id)?.name ?? id.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/** Relative luminance (0..1) of a #rgb / #rrggbb color, or null if it isn't one. */
function luminance(hex: string): number | null {
  let h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())?.[1];
  if (!h) return null;
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h!.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Parse a theme's colors.toml into a palette, filling missing colors the same way
 * scripts/import-omarchy-themes.mjs does. Null without a background and foreground.
 */
export function parseOmarchyColors(id: string, toml: string): OmarchyPalette | null {
  const t: Record<string, string> = {};
  for (const line of toml.split('\n')) {
    const m = /^\s*([a-z_]+)\s*=\s*["']([^"']+)["']/.exec(line);
    if (m) t[m[1]] = m[2].trim();
  }
  if (!t.background || !t.foreground) return null;
  const mode = t.mode === 'light' || t.mode === 'dark' ? t.mode : (luminance(t.background) ?? 0) > 0.5 ? 'light' : 'dark';
  const p = { id, name: omarchyName(id), mode } as OmarchyPalette;
  for (const k of KEYS) p[k] = t[k] ?? (k.includes('background') ? t.background : k.includes('foreground') ? t.foreground : t.accent ?? t.blue ?? t.foreground);
  return p;
}
