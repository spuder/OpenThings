import { describe, expect, it } from 'vitest';
import { previousValues, UndoStack } from './undo';

describe('UndoStack', () => {
  it('undoes the latest step first', () => {
    const log: string[] = [];
    const s = new UndoStack();
    s.push('a', () => log.push('a'));
    s.push('b', () => log.push('b'));
    expect(s.undo()).toBe('b');
    expect(s.undo()).toBe('a');
    expect(s.undo()).toBeNull();
    expect(log).toEqual(['b', 'a']);
  });

  it('drops the oldest step past the limit', () => {
    const s = new UndoStack(2);
    s.push('a', () => {});
    s.push('b', () => {});
    s.push('c', () => {});
    expect(s.size).toBe(2);
    expect(s.undo()).toBe('c');
    expect(s.undo()).toBe('b');
    expect(s.undo()).toBeNull();
  });
});

describe('previousValues', () => {
  it('picks the current values of the changed fields', () => {
    const row = { id: '1', title: 'Old', when_date: '2026-10-18' as string | null, urgent: 0 };
    expect(previousValues(row, { when_date: null, urgent: 1 })).toEqual({ when_date: '2026-10-18', urgent: 0 });
  });
});
