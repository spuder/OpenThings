import { describe, expect, it } from 'vitest';
import { omarchyName, parseOmarchyColors } from './omarchy';

const tokyo = `mode = "dark"

accent = "#7aa2f7"
background = "#1a1b26"
dark_background = "#13141c"
foreground = "#a9b1d6"
red = "#f7768e"
bright_red = "#ff7a93"
`;

describe('parseOmarchyColors', () => {
  it('reads the palette and fills missing colors', () => {
    const p = parseOmarchyColors('tokyo-night', tokyo)!;
    expect(p.name).toBe('Tokyo Night');
    expect(p.mode).toBe('dark');
    expect(p.background).toBe('#1a1b26');
    expect(p.dark_background).toBe('#13141c');
    expect(p.lighter_background).toBe('#1a1b26');
    expect(p.dark_foreground).toBe('#a9b1d6');
    expect(p.red).toBe('#f7768e');
    expect(p.green).toBe('#7aa2f7');
  });

  it('works out light or dark when the theme does not say', () => {
    expect(parseOmarchyColors('paper', 'background = "#fdf6e3"\nforeground = "#333"')!.mode).toBe('light');
    expect(parseOmarchyColors('ink', "background = '#111'\nforeground = '#eee'")!.mode).toBe('dark');
  });

  it('needs a background and a foreground', () => {
    expect(parseOmarchyColors('x', 'accent = "#fff"')).toBeNull();
    expect(parseOmarchyColors('x', '')).toBeNull();
  });
});

describe('omarchyName', () => {
  it('uses the bundled name, or title-cases the id', () => {
    expect(omarchyName('catppuccin-latte')).toBe('Catppuccin Latte');
    expect(omarchyName('my-own-theme')).toBe('My Own Theme');
  });
});
