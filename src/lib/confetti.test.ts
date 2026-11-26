import { describe, expect, it } from 'vitest';
import { burst, step, TERMINAL } from './confetti';

function seq(values: number[]) {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe('confetti', () => {
  it('bursts the requested number of pieces at the origin, aimed along the angle', () => {
    const ps = burst(20, 100, 500, -Math.PI / 2, 0, 1000, ['a', 'b']);
    expect(ps).toHaveLength(20);
    for (const p of ps) {
      expect(p.x).toBe(100);
      expect(p.y).toBe(500);
      expect(p.vy).toBeLessThan(0); // up
      expect(Math.abs(p.vx)).toBeLessThan(1e-6);
      expect(['a', 'b']).toContain(p.color);
    }
  });

  it('never picks a color past the end of the list', () => {
    const ps = burst(5, 0, 0, 0, 1, 100, ['only'], seq([0.9999999]));
    expect(ps.every((p) => p.color === 'only')).toBe(true);
  });

  it('a zero step changes nothing', () => {
    const ps = burst(3, 10, 20, 0, 1, 500, ['x'], seq([0.3, 0.6]));
    const before = JSON.stringify(ps);
    step(ps, 0, 1000);
    // Only the flutter sway moves x on a zero step; y and velocity stay put.
    expect(ps.map((p) => [p.y, p.vx, p.vy])).toEqual(JSON.parse(before).map((p: { y: number; vx: number; vy: number }) => [p.y, p.vx, p.vy]));
  });

  it('pieces rise, slow down, fall, and are dropped below the floor', () => {
    let ps = burst(1, 0, 400, -Math.PI / 2, 0, 900, ['x'], seq([0.5]));
    const y0 = ps[0]!.y;
    ps = step(ps, 0.05, 400);
    expect(ps[0]!.y).toBeLessThan(y0);
    for (let i = 0; i < 400 && ps.length; i++) ps = step(ps, 1 / 60, 400);
    expect(ps).toHaveLength(0);
  });

  it('falls no faster than a flutter once it has been dropping a while', () => {
    let ps = burst(1, 0, 0, Math.PI / 2, 0, 0.0001, ['x'], seq([0.5]));
    for (let i = 0; i < 120; i++) ps = step(ps, 1 / 60, 1e9);
    expect(ps[0]!.vy).toBeLessThanOrEqual(TERMINAL * 1.3);
  });
});
