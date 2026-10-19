import { describe, expect, it } from 'vitest';
import { classifySwipe } from './gesture';

describe('classifySwipe', () => {
  it('detects a quick horizontal swipe in either direction', () => {
    expect(classifySwipe(120, 10, 200)).toBe('right');
    expect(classifySwipe(-90, -20, 300)).toBe('left');
  });

  it('ignores short drags', () => {
    expect(classifySwipe(40, 0, 100)).toBeNull();
  });

  it('ignores mostly vertical movement (scrolling)', () => {
    expect(classifySwipe(80, 60, 200)).toBeNull();
    expect(classifySwipe(10, 300, 200)).toBeNull();
  });

  it('ignores slow drags', () => {
    expect(classifySwipe(150, 0, 1200)).toBeNull();
  });
});
