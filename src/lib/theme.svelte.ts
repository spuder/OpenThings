/** Appearance preference, per device (not synced): follow the system, or force light/dark. */
export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'openthings.theme';

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const systemDark = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;

class Theme {
  pref = $state<ThemePref>(typeof localStorage === 'undefined' ? 'system' : read());

  /** What's actually on screen right now. */
  get isDark(): boolean {
    return this.pref === 'dark' || (this.pref === 'system' && systemDark());
  }

  set(pref: ThemePref) {
    this.pref = pref;
    try {
      if (pref === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, pref);
    } catch {
      /* storage unavailable: applies for this session only */
    }
    this.apply();
  }

  /** Light ↔ dark from whatever is showing now. */
  toggle() {
    this.set(this.isDark ? 'light' : 'dark');
  }

  apply() {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (this.pref === 'system') delete root.dataset.theme;
    else root.dataset.theme = this.pref;
    // Keep the browser/OS chrome (address bar, status bar) in step.
    const color = this.isDark ? '#1d1e21' : '#ffffff';
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      if (this.pref === 'system') {
        m.setAttribute('content', m.getAttribute('media')?.includes('dark') ? '#1d1e21' : '#ffffff');
      } else {
        m.setAttribute('content', color);
      }
    });
  }
}

export const theme = new Theme();
