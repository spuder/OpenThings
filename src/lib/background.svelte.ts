/** Animated background style, per device (not synced). 'none' is the plain background. */
export type BackgroundStyle = 'none' | 'aurora' | 'particles' | 'waves';

export const BACKGROUNDS: [BackgroundStyle, string][] = [
  ['none', 'None'],
  ['aurora', 'Aurora'],
  ['particles', 'Particles'],
  ['waves', 'Waves'],
];

const KEY = 'openthings.background';

function load(): BackgroundStyle {
  try {
    const v = localStorage.getItem(KEY);
    if (BACKGROUNDS.some(([id]) => id === v)) return v as BackgroundStyle;
  } catch {
    /* ignore */
  }
  return 'none';
}

class Background {
  style = $state<BackgroundStyle>(load());

  set(style: BackgroundStyle) {
    this.style = style;
    try {
      localStorage.setItem(KEY, style);
    } catch {
      /* ignore */
    }
  }
}

export const background = new Background();
