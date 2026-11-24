/**
 * Fallback tracking for a held Ctrl key, from the key's own events.
 *
 * On Wayland, fcitx5 drops a held modifier from key events once a text field loses focus, so
 * holding Ctrl and pressing K again would arrive as a plain K. The Ctrl key-up still arrives, so
 * there we trust the key over the event flag.
 *
 * macOS reports ⌘ reliably on every event, and its key-up is often never delivered (⌘Tab,
 * Spotlight, screenshots, a global hotkey). A stale flag would turn ordinary typing into
 * shortcuts, so the fallback is off on macOS, and is never applied inside a text field, where a
 * stuck flag would do the most damage.
 */
export function modifierTracker(isMac: boolean) {
  let held = false;
  return {
    /** Feed window keydown / keyup / blur here. */
    track(e: { type: string; key?: string }) {
      if (isMac) return;
      if (e.type === 'blur') held = false;
      else if (e.key === 'Control') held = e.type === 'keydown';
    },
    /** Whether to treat Ctrl as held when the event itself doesn't say so. */
    held(typing: boolean): boolean {
      return !isMac && !typing && held;
    },
  };
}
