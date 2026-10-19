/**
 * Keep what you're editing above the on-screen keyboard.
 *
 * On iOS the keyboard overlays the page instead of shrinking it, so our scroll container doesn't know
 * the bottom of the screen is hidden. We read the keyboard height from `visualViewport`, expose it as
 * `--kb` and the `kb-open` class on <html> (lists add it as bottom padding so the last rows can scroll
 * up; quick add sits just above the keyboard), and scroll the open to-do,
 * or the focused field, into the visible part.
 */

/** How far to scroll (positive = content moves up) so [top, bottom] fits in the visible band. */
export function scrollDelta(top: number, bottom: number, visibleTop: number, visibleBottom: number, margin = 12): number {
  const low = visibleBottom - margin;
  const high = visibleTop + margin;
  if (bottom <= low) return top < high ? top - high : 0;
  // Too tall to fit: keep its top in view rather than its bottom.
  return Math.min(bottom - low, top - high);
}

let kb = 0;
/** Set once the native shell reports the keyboard itself; visualViewport is then ignored. */
let nativeDriven = false;

/** Scroll the open to-do (or the focused field) into the part of its list above the keyboard. */
function reveal() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !/^(INPUT|TEXTAREA)$/.test(active.tagName)) return;
  const target = active.closest<HTMLElement>('.task.expanded') ?? active;
  const scroller = target.closest<HTMLElement>('.scroll');
  if (!scroller) return;
  const r = target.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  const top = Math.max(box.top, window.visualViewport?.offsetTop ?? 0);
  const d = scrollDelta(r.top, r.bottom, top, Math.min(box.bottom, window.innerHeight - kb));
  if (d) scroller.scrollBy({ top: d, behavior: 'smooth' });
}

function apply(next: number) {
  next = Math.max(0, Math.round(next));
  if (next === kb) return;
  kb = next;
  const root = document.documentElement;
  root.style.setProperty('--kb', `${kb}px`);
  root.classList.toggle('kb-open', kb > 0);
  // Wait a frame so the new padding is laid out before scrolling.
  if (kb > 0) requestAnimationFrame(reveal);
}

/**
 * Keyboard height from the native shell (Capacitor Keyboard plugin). In the iOS app the web view
 * isn't resized and visualViewport doesn't see the keyboard, so this is the only reliable source there.
 */
export function setKeyboardHeight(px: number): void {
  nativeDriven = true;
  apply(px);
}

/** Browser / PWA: read the keyboard from visualViewport. Call once at startup. */
export function installKeyboardInset(): void {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return;
  const update = () => {
    if (!nativeDriven) apply(window.innerHeight - vv.height - vv.offsetTop);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  // Moving between fields while the keyboard stays up (title → notes → checklist).
  document.addEventListener('focusin', () => {
    if (kb > 0) requestAnimationFrame(reveal);
  });
}
