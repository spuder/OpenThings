import { describe, expect, it } from 'vitest';
import { modifierTracker } from './modifier';

describe('modifierTracker', () => {
  it('remembers a held Ctrl outside text fields (Wayland / fcitx5)', () => {
    const m = modifierTracker(false);
    m.track({ type: 'keydown', key: 'Control' });
    expect(m.held(false)).toBe(true);
    m.track({ type: 'keyup', key: 'Control' });
    expect(m.held(false)).toBe(false);
  });

  it('forgets it when the window loses focus', () => {
    const m = modifierTracker(false);
    m.track({ type: 'keydown', key: 'Control' });
    m.track({ type: 'blur' });
    expect(m.held(false)).toBe(false);
  });

  it('never applies inside a text field, so a lost key-up cannot hijack typing', () => {
    const m = modifierTracker(false);
    m.track({ type: 'keydown', key: 'Control' });
    expect(m.held(true)).toBe(false);
  });

  it('is off on macOS, where a ⌘ key-up is often swallowed', () => {
    const m = modifierTracker(true);
    m.track({ type: 'keydown', key: 'Meta' });
    m.track({ type: 'keydown', key: 'Control' });
    expect(m.held(false)).toBe(false);
  });
});
