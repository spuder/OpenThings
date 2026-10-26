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

describe('UndoStack.group', () => {
  it('undoes a bulk action in one step, newest change first', () => {
    const log: string[] = [];
    const s = new UndoStack();
    s.push('before', () => log.push('before'));
    s.group('complete', () => {
      s.push('complete', () => log.push('a'));
      s.push('complete', () => log.push('b'));
      s.push('complete', () => log.push('c'));
    });
    expect(s.size).toBe(2);
    expect(s.undo()).toBe('complete');
    expect(log).toEqual(['c', 'b', 'a']);
    expect(s.undo()).toBe('before');
  });

  it('keeps a lone step as it is, records nothing for an empty group, and nests', () => {
    const s = new UndoStack();
    s.group('bulk', () => s.push('move', () => {}));
    expect(s.size).toBe(1);
    s.group('bulk', () => {});
    expect(s.size).toBe(1);
    s.group('outer', () => {
      s.push('a', () => {});
      s.group('inner', () => s.push('b', () => {}));
    });
    expect(s.size).toBe(2);
    expect(s.undo()).toBe('outer');
    expect(s.undo()).toBe('move');
  });

  it('still records the steps if the action throws', () => {
    const s = new UndoStack();
    expect(() =>
      s.group('bulk', () => {
        s.push('a', () => {});
        s.push('b', () => {});
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(s.size).toBe(1);
    // And a later push isn't swallowed by a group left open.
    s.push('c', () => {});
    expect(s.size).toBe(2);
  });
});

describe('previousValues', () => {
  it('picks the current values of the changed fields', () => {
    const row = { id: '1', title: 'Old', when_date: '2026-10-18' as string | null, urgent: 0 };
    expect(previousValues(row, { when_date: null, urgent: 1 })).toEqual({ when_date: '2026-10-18', urgent: 0 });
  });
});
