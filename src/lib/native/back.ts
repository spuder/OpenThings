/**
 * What Android's back button / back gesture does (src/lib/native/capacitor.svelte.ts). Without a
 * handler Capacitor closes the app on back, even with quick add or a to-do open.
 *
 * Back steps out one level at a time, like Escape on a keyboard:
 *   - `drawer`: close the list drawer.
 *   - `escape`: close what's open (an overlay, the open to-do, a menu) or end a multi-selection.
 *     The app is sent an Escape key, so each piece closes the way it does from the keyboard.
 *   - `today`: in any other list, go back to Today, the app's home.
 *   - `exit`: on Today with nothing open, leave the app (it keeps running, like Home).
 */
export type BackStep = 'drawer' | 'escape' | 'today' | 'exit';

export interface BackState {
  sidebarOpen: boolean;
  overlay: string | null;
  expandedId: string | null;
  isMulti: boolean;
  selecting: boolean;
  /** A menu or popup is showing (e.g. Sidebar's "New list" menu). */
  menuOpen: boolean;
  viewKind: string;
}

export function backStep(s: BackState): BackStep {
  // Top to bottom: overlays and menus sit above the drawer, the drawer above the list.
  if (s.overlay || s.menuOpen) return 'escape';
  if (s.sidebarOpen) return 'drawer';
  if (s.expandedId || s.isMulti || s.selecting) return 'escape';
  if (s.viewKind !== 'today') return 'today';
  return 'exit';
}
