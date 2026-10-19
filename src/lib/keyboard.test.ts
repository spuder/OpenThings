import { describe, expect, it } from 'vitest';
import { scrollDelta } from './keyboard';

// Visible band 0..400 (keyboard covers below 400), margin 12.
describe('scrollDelta', () => {
  it('leaves something already visible alone', () => {
    expect(scrollDelta(100, 200, 0, 400)).toBe(0);
  });

  it('scrolls up so a row under the keyboard sits just above it', () => {
    expect(scrollDelta(500, 600, 0, 400)).toBe(212);
  });

  it('keeps the top in view when the row is taller than the visible band', () => {
    expect(scrollDelta(300, 900, 0, 400)).toBe(288);
  });

  it('scrolls down when the row is above the visible band', () => {
    expect(scrollDelta(-50, 50, 0, 400)).toBe(-62);
  });
});
