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

export function installKeyboardInset(): void {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return;
  const root = document.documentElement;
  let kb = 0;

  function reveal() {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !/^(INPUT|TEXTAREA)$/.test(active.tagName)) return;
    const target = active.closest<HTMLElement>('.task.expanded') ?? active;
    const scroller = target.closest<HTMLElement>('.scroll');
    if (!scroller || !vv) return;
    const r = target.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    const d = scrollDelta(r.top, r.bottom, Math.max(box.top, vv.offsetTop), Math.min(box.bottom, vv.offsetTop + vv.height));
    if (d) scroller.scrollBy({ top: d, behavior: 'smooth' });
  }

  function update() {
    if (!vv) return;
    const next = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    if (next === kb) return;
    kb = next;
    root.style.setProperty('--kb', `${kb}px`);
    root.classList.toggle('kb-open', kb > 0);
    // Wait a frame so the new padding is laid out before scrolling.
    if (kb > 0) requestAnimationFrame(reveal);
  }

  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  // Moving between fields while the keyboard stays up (title → notes → checklist).
  document.addEventListener('focusin', () => {
    if (kb > 0) requestAnimationFrame(reveal);
  });
}
