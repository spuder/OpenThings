/** True on touch-first devices (phones, tablets) where there is no hover and no double click. */
export const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(hover: none) and (pointer: coarse)').matches;

/** Reactive-free check for narrow (phone) layouts at call time. */
export function isNarrow(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(max-width: 760px)').matches;
}
