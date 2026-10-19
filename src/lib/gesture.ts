/** Horizontal swipe detection for the phone list drawer. Pure so it can be tested. */

export type Swipe = 'left' | 'right' | null;

/** Minimum horizontal travel in px. */
export const SWIPE_MIN_DX = 60;
/** Vertical travel may be at most this fraction of horizontal travel, so scrolling never counts. */
export const SWIPE_MAX_SLOPE = 0.5;
/** Slower drags are treated as something else (selecting text, hesitating). */
export const SWIPE_MAX_MS = 700;

export function classifySwipe(dx: number, dy: number, ms: number): Swipe {
  if (ms > SWIPE_MAX_MS) return null;
  if (Math.abs(dx) < SWIPE_MIN_DX) return null;
  if (Math.abs(dy) > Math.abs(dx) * SWIPE_MAX_SLOPE) return null;
  return dx > 0 ? 'right' : 'left';
}

/** Touches that start in text fields or anything marked `data-no-swipe` keep their own gestures. */
export function swipeIgnored(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-no-swipe]');
}
