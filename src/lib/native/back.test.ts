import { describe, expect, it } from 'vitest';
import { backStep, type BackState } from './back';

const idle: BackState = { sidebarOpen: false, overlay: null, expandedId: null, isMulti: false, selecting: false, menuOpen: false, viewKind: 'today' };

describe('backStep', () => {
  it('leaves the app from Today with nothing open', () => {
    expect(backStep(idle)).toBe('exit');
  });

  it('goes back to Today from any other list', () => {
    expect(backStep({ ...idle, viewKind: 'inbox' })).toBe('today');
    expect(backStep({ ...idle, viewKind: 'settings' })).toBe('today');
  });

  it('closes what is open before navigating', () => {
    for (const s of [{ overlay: 'quickadd' }, { expandedId: 't1' }, { isMulti: true }, { selecting: true }, { menuOpen: true }]) {
      expect(backStep({ ...idle, viewKind: 'inbox', ...s })).toBe('escape');
    }
  });

  it('closes overlays and menus above the drawer first, then the drawer', () => {
    expect(backStep({ ...idle, sidebarOpen: true, overlay: 'palette' })).toBe('escape');
    expect(backStep({ ...idle, sidebarOpen: true, menuOpen: true })).toBe('escape');
    expect(backStep({ ...idle, sidebarOpen: true })).toBe('drawer');
    expect(backStep({ ...idle, sidebarOpen: true, expandedId: 't1' })).toBe('drawer');
  });
});
