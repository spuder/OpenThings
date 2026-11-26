/**
 * Confetti physics for the project-complete celebration, kept pure so it can be tested.
 * Written for this project. Units are CSS pixels and seconds.
 */

export interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Rotation in the plane, radians, and its speed. */
  rot: number;
  spin: number;
  /** Phase of the flip around the piece's long axis; its cosine squashes the drawn width. */
  flip: number;
  flipSpeed: number;
  /** Fraction of velocity this piece keeps per second; varied so a burst doesn't move as one sheet. */
  drag: number;
  w: number;
  h: number;
  color: string;
  round: boolean;
}

export const GRAVITY = 900;
/** Flat pieces flutter: they never fall faster than this. */
export const TERMINAL = 240;

/** A burst of `n` pieces from (x, y), fanned around `angle` (radians, 0 = right, -π/2 = up). */
export function burst(n: number, x: number, y: number, angle: number, spread: number, speed: number, colors: string[], rand = Math.random): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i < n; i++) {
    const a = angle + (rand() - 0.5) * spread;
    const v = speed * (0.45 + rand() * 0.7);
    out.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      rot: rand() * Math.PI * 2,
      spin: (rand() - 0.5) * 14,
      flip: rand() * Math.PI * 2,
      flipSpeed: 6 + rand() * 8,
      drag: 0.3 + rand() * 0.4,
      w: 6 + rand() * 6,
      h: 4 + rand() * 4,
      color: colors[Math.floor(rand() * colors.length) % colors.length] ?? '#888',
      round: rand() < 0.25,
    });
  }
  return out;
}

/** Advance every piece by `dt` seconds in place; returns the pieces still above `floor`. */
export function step(pieces: Piece[], dt: number, floor: number): Piece[] {
  for (const p of pieces) {
    const keep = Math.pow(p.drag, dt);
    p.vx *= keep;
    p.vy = p.vy * keep + GRAVITY * dt;
    p.vy = Math.min(p.vy, TERMINAL * (0.6 + p.drag));
    p.x += p.vx * dt + Math.sin(p.flip) * 0.6;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
    p.flip += p.flipSpeed * dt;
  }
  return pieces.filter((p) => p.y < floor + 20);
}
