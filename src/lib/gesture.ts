/** Swipe detection for phone gestures (list drawer, pull down for Quick Find). Pure so it can be tested. */

export type Swipe = 'left' | 'right' | 'up' | 'down' | null;

/** Minimum horizontal travel in px. */
export const SWIPE_MIN_DX = 60;
/** Vertical travel may be at most this fraction of horizontal travel, so scrolling never counts. */
export const SWIPE_MAX_SLOPE = 0.5;
/** Slower drags are treated as something else (selecting text, hesitating). */
export const SWIPE_MAX_MS = 700;

/** Vertical swipes need a longer pull than horizontal ones, so ordinary scrolling flicks don't count. */
export const SWIPE_MIN_DY = 80;

export function classifySwipe(dx: number, dy: number, ms: number): Swipe {
  if (ms > SWIPE_MAX_MS) return null;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= SWIPE_MIN_DX && ay <= ax * SWIPE_MAX_SLOPE) return dx > 0 ? 'right' : 'left';
  if (ay >= SWIPE_MIN_DY && ax <= ay * SWIPE_MAX_SLOPE) return dy > 0 ? 'down' : 'up';
  return null;
}

/** Touches that start in text fields or anything marked `data-no-swipe` keep their own gestures. */
export function swipeIgnored(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-no-swipe]');
}
