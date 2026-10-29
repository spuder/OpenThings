/**
 * Appearance, per device (not synced):
 *   - base preference: follow the system, or force light / dark
 *   - optional Omarchy theme (desktop): a full palette mapped onto the app's color tokens
 * On an Omarchy desktop the desktop app follows the system theme instead (`follow`), and the
 * choices above are kept for when it no longer does.
 */
import { omarchyThemes, type OmarchyPalette } from './omarchy-themes';

export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'openthings.theme';
const OMARCHY_KEY = 'openthings.omarchy';
/** Resolved CSS variables of the chosen Omarchy theme, applied by index.html before first paint. */
const VARS_KEY = 'openthings.themeVars';

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: applies for this session only */
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const systemDark = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
const mix = (a: string, pct: number, b: string) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;

/** Map an Omarchy palette onto the tokens defined in app.css. */
export function paletteVars(p: OmarchyPalette): Record<string, string> {
  const dark = p.mode === 'dark';
  const surface = dark ? p.lighter_background : p.background;
  return {
    '--bg': p.background,
    '--sidebar': p.dark_background,
    '--sidebar-hover': mix(p.foreground, 7, p.dark_background),
    '--sidebar-active': mix(p.accent, 18, p.dark_background),
    '--text': p.foreground,
    '--text-2': mix(p.foreground, 72, p.background),
    '--text-3': mix(p.foreground, 48, p.background),
    '--line': mix(p.foreground, 11, p.background),
    '--line-strong': mix(p.foreground, 22, p.background),
    '--accent': p.accent,
    '--accent-soft': mix(p.accent, 18, 'transparent'),
    '--select': mix(p.accent, 15, 'transparent'),
    '--card': surface,
    '--card-shadow': dark ? '0 1px 2px rgba(0,0,0,.4), 0 10px 30px rgba(0,0,0,.45)' : '0 1px 2px rgba(0,0,0,.06), 0 8px 28px rgba(0,0,0,.1)',
    '--chip': mix(p.foreground, 9, p.background),
    '--star': p.yellow,
    '--evening': p.blue,
    '--deadline': p.red,
    '--someday': mix(p.yellow, 55, p.foreground),
    '--logbook': p.green,
    '--upcoming': p.red,
    '--week': mix(p.blue, 60, p.magenta),
    '--anytime': p.cyan,
    '--inbox': p.blue,
    '--dump': p.yellow,
    '--habits': p.orange,
    '--matrix': p.magenta,
    '--urgent': p.red,
    '--important': p.blue,
    '--paper': mix(p.yellow, dark ? 6 : 9, p.background),
    '--paper-line': mix(p.foreground, 12, p.background),
    '--paper-margin': mix(p.red, 45, p.background),
    '--paper-ink': p.foreground,
    '--paper-shadow': dark ? '0 1px 1px rgba(0,0,0,.3), 0 10px 30px rgba(0,0,0,.4)' : '0 1px 1px rgba(80,60,20,.08), 0 10px 30px rgba(80,60,20,.12)',
  };
}

class Theme {
  pref = $state<ThemePref>(typeof localStorage === 'undefined' ? 'system' : ((v) => (v === 'light' || v === 'dark' ? v : 'system'))(read(KEY)));
  /** Chosen Omarchy theme id, or null for the app's own palette. */
  omarchy = $state<string | null>(typeof localStorage === 'undefined' ? null : read(OMARCHY_KEY));
  /** The Omarchy desktop's theme, which overrides the choices above while it's set. */
  desktop = $state<OmarchyPalette | null>(null);
  /** Theme shown temporarily while browsing the picker. */
  private previewId: string | null | undefined = undefined;
  private applied: string[] = [];

  /** The appearance follows the Omarchy desktop and can't be chosen in the app. */
  get following(): boolean {
    return this.desktop !== null;
  }

  get palette(): OmarchyPalette | undefined {
    return this.desktop ?? omarchyThemes.find((t) => t.id === this.omarchy);
  }

  /** What's actually on screen right now. */
  get isDark(): boolean {
    const p = this.palette;
    if (p) return p.mode === 'dark';
    return this.pref === 'dark' || (this.pref === 'system' && systemDark());
  }

  set(pref: ThemePref) {
    if (this.following) return;
    this.pref = pref;
    this.omarchy = null;
    store(KEY, pref === 'system' ? null : pref);
    store(OMARCHY_KEY, null);
    this.apply();
  }

  setOmarchy(id: string | null) {
    if (this.following) return;
    this.omarchy = id;
    this.previewId = undefined;
    store(OMARCHY_KEY, id);
    this.apply();
  }

  /** Show a theme without saving it (picker hover / arrow keys). `undefined` ends the preview. */
  preview(id: string | null | undefined) {
    this.previewId = id;
    this.apply();
  }

  /** Follow the Omarchy desktop's theme (null: stop, back to the saved choice). */
  follow(p: OmarchyPalette | null) {
    this.desktop = p;
    this.previewId = undefined;
    this.apply();
  }

  /** Light ↔ dark from whatever is showing now (leaves any Omarchy theme). */
  toggle() {
    if (this.following) return;
    const dark = this.isDark;
    this.set(dark ? 'light' : 'dark');
  }

  apply() {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const id = this.previewId !== undefined ? this.previewId : this.omarchy;
    const p = this.desktop ?? omarchyThemes.find((t) => t.id === id);

    for (const k of this.applied) root.style.removeProperty(k);
    this.applied = [];

    if (p) {
      const vars = paletteVars(p);
      for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
      this.applied = Object.keys(vars);
      root.dataset.theme = p.mode;
      root.style.colorScheme = p.mode;
      if (this.previewId === undefined) store(VARS_KEY, JSON.stringify({ mode: p.mode, vars }));
    } else {
      root.style.removeProperty('color-scheme');
      if (this.pref === 'system') delete root.dataset.theme;
      else root.dataset.theme = this.pref;
      if (this.previewId === undefined) store(VARS_KEY, null);
    }

    // Keep the browser/OS chrome (address bar, status bar) in step.
    const color = p ? p.background : this.isDark ? '#1d1e21' : '#ffffff';
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      if (!p && this.pref === 'system') m.setAttribute('content', m.getAttribute('media')?.includes('dark') ? '#1d1e21' : '#ffffff');
      else m.setAttribute('content', color);
    });
  }
}

export const theme = new Theme();
