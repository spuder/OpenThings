import { describe, expect, it } from 'vitest';
import { classifyRowSwipe, classifySwipe, ROW_SWIPE_COMMIT } from './gesture';

describe('classifySwipe', () => {
  it('detects a quick horizontal swipe in either direction', () => {
    expect(classifySwipe(120, 10, 200)).toBe('right');
    expect(classifySwipe(-90, -20, 300)).toBe('left');
  });

  it('ignores short drags', () => {
    expect(classifySwipe(40, 0, 100)).toBeNull();
  });

  it('ignores diagonal movement', () => {
    expect(classifySwipe(80, 60, 200)).toBeNull();
  });

  it('detects a long quick vertical pull, but not a short one', () => {
    expect(classifySwipe(10, 300, 200)).toBe('down');
    expect(classifySwipe(-5, -120, 200)).toBe('up');
    expect(classifySwipe(0, 50, 200)).toBeNull();
  });

  it('ignores slow drags', () => {
    expect(classifySwipe(150, 0, 1200)).toBeNull();
  });
});

describe('classifyRowSwipe', () => {
  it('right completes, left deletes, short drags do nothing', () => {
    expect(classifyRowSwipe(ROW_SWIPE_COMMIT)).toBe('complete');
    expect(classifyRowSwipe(-ROW_SWIPE_COMMIT - 10)).toBe('delete');
    expect(classifyRowSwipe(ROW_SWIPE_COMMIT - 1)).toBeNull();
    expect(classifyRowSwipe(-20)).toBeNull();
  });
});
