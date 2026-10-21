import { describe, expect, it } from 'vitest';
import {
  canReorder,
  EMPTY,
  extend,
  groupFields,
  inOrder,
  moveBlock,
  prune,
  range,
  selectAll,
  selectOnly,
  stepTarget,
  toggle,
} from './selection';
import type { Task } from './types';

const order = ['a', 'b', 'c', 'd', 'e'];

describe('selection', () => {
  it('keeps ids in visible order', () => {
    expect(inOrder(['d', 'a', 'zz', 'b'], order)).toEqual(['a', 'b', 'd']);
  });

  it('toggles single rows and moves the anchor', () => {
    let s = selectOnly('b');
    s = toggle(s, 'd', order);
    expect(s).toEqual({ ids: ['b', 'd'], anchor: 'd', cursor: 'd' });
    s = toggle(s, 'a', order);
    expect(s.ids).toEqual(['a', 'b', 'd']);
    s = toggle(s, 'b', order);
    expect(s.ids).toEqual(['a', 'd']);
    expect(s.anchor).toBe('b');
    expect(s.cursor).toBe('d');
  });

  it('selects a range from the anchor, either direction', () => {
    expect(range(selectOnly('b'), 'd', order)).toEqual({ ids: ['b', 'c', 'd'], anchor: 'b', cursor: 'd' });
    expect(range(selectOnly('d'), 'a', order).ids).toEqual(['a', 'b', 'c', 'd']);
    // A second Shift click replaces the range, keeping the anchor.
    const s = range(range(selectOnly('c'), 'e', order), 'a', order);
    expect(s).toEqual({ ids: ['a', 'b', 'c'], anchor: 'c', cursor: 'a' });
  });

  it('starts a range at the clicked row without an anchor', () => {
    expect(range(EMPTY, 'c', order).ids).toEqual(['c']);
    expect(range({ ids: [], anchor: 'gone', cursor: null }, 'c', order).ids).toEqual(['c']);
  });

  it('a range after ⌘ click starts at the toggled row', () => {
    const s = toggle(selectOnly('a'), 'c', order);
    expect(range(s, 'e', order).ids).toEqual(['c', 'd', 'e']);
  });

  it('extends with Shift+arrows and shrinks back past the anchor', () => {
    let s = selectOnly('c');
    s = extend(s, 1, order);
    expect(s).toEqual({ ids: ['c', 'd'], anchor: 'c', cursor: 'd' });
    s = extend(s, 1, order);
    expect(s.ids).toEqual(['c', 'd', 'e']);
    s = extend(s, 1, order); // clamps at the end
    expect(s.ids).toEqual(['c', 'd', 'e']);
    s = extend(extend(extend(s, -1, order), -1, order), -1, order);
    expect(s).toEqual({ ids: ['b', 'c'], anchor: 'c', cursor: 'b' });
  });

  it('extending with nothing selected starts at the first or last row', () => {
    expect(extend(EMPTY, 1, order).ids).toEqual(['a']);
    expect(extend(EMPTY, -1, order).ids).toEqual(['e']);
    expect(extend(EMPTY, 1, [])).toBe(EMPTY);
  });

  it('selects all, keeping the cursor if visible', () => {
    expect(selectAll(order, 'c')).toEqual({ ids: order, anchor: 'a', cursor: 'c' });
    expect(selectAll(order, 'zz').cursor).toBe('a');
    expect(selectAll([], null)).toBe(EMPTY);
  });

  it('prunes rows that left the list', () => {
    const s = { ids: ['a', 'c', 'e'], anchor: 'a', cursor: 'e' };
    expect(prune(s, order)).toBe(s);
    expect(prune(s, ['a', 'b', 'd'])).toEqual({ ids: ['a'], anchor: 'a', cursor: 'a' });
    expect(prune(s, ['b', 'd'])).toEqual({ ids: [], anchor: null, cursor: null });
  });
});

const rows = (...sorts: number[]) => sorts.map((sort, i) => ({ id: 'abcdefgh'[i], sort }));

/** Apply new sorts and read the order back, like the list would after reloading. */
function apply(items: { id: string; sort: number }[], updates: { id: string; sort: number }[]) {
  const m = new Map(updates.map((u) => [u.id, u.sort]));
  return items
    .map((t) => ({ id: t.id, sort: m.get(t.id) ?? t.sort }))
    .sort((x, y) => x.sort - y.sort)
    .map((t) => t.id)
    .join('');
}

describe('moveBlock', () => {
  const items = rows(1, 2, 3, 4, 5); // a b c d e

  it('moves several rows between two others, evenly spaced, keeping their order', () => {
    const u = moveBlock(items, ['d', 'a'], 'c');
    expect(u).toEqual([
      { id: 'a', sort: 2 + 1 / 3 },
      { id: 'd', sort: 2 + 2 / 3 },
    ]);
    expect(apply(items, u)).toBe('badce');
  });

  it('moves to the end and to the start', () => {
    expect(apply(items, moveBlock(items, ['a', 'c'], null))).toBe('bdeac');
    expect(moveBlock(items, ['a', 'c'], null)).toEqual([
      { id: 'a', sort: 6 },
      { id: 'c', sort: 7 },
    ]);
    expect(apply(items, moveBlock(items, ['d', 'e'], 'a'))).toBe('deabc');
    expect(moveBlock(items, ['d', 'e'], 'a')).toEqual([
      { id: 'd', sort: -1 },
      { id: 'e', sort: 0 },
    ]);
  });

  it('dropping onto one of the moving rows lands before the next row that is not moving', () => {
    expect(apply(items, moveBlock(items, ['b', 'd'], 'b'))).toBe('abdce');
    expect(apply(items, moveBlock(items, ['d', 'e'], 'e'))).toBe('abcde');
  });

  it('only changes the moving rows', () => {
    const u = moveBlock(items, ['b', 'e'], 'd');
    expect(u.map((x) => x.id)).toEqual(['b', 'e']);
  });

  it('works with uneven and negative sorts', () => {
    const odd = rows(-10, 0.5, 0.75, 100);
    const u = moveBlock(odd, ['a', 'd'], 'c');
    expect(apply(odd, u)).toBe('badc');
    for (const x of u) expect(x.sort > 0.5 && x.sort < 0.75).toBe(true);
  });

  it('takes rows dragged in from another group, after the ones already there', () => {
    const u = moveBlock(items, ['x', 'b'], 'd');
    expect(u.map((x) => x.id)).toEqual(['b', 'x']);
    for (const x of u) expect(x.sort > 3 && x.sort < 4).toBe(true);
  });

  it('handles an empty target group and nothing to move', () => {
    expect(moveBlock([], ['x', 'y'], null)).toEqual([
      { id: 'x', sort: 0 },
      { id: 'y', sort: 1 },
    ]);
    expect(moveBlock(items, [], 'c')).toEqual([]);
  });
});

describe('stepTarget', () => {
  const items = rows(1, 2, 3, 4); // a b c d
  const step = (moving: string[], dir: -1 | 1) => {
    const before = stepTarget(items, moving, dir);
    return before === undefined ? 'none' : apply(items, moveBlock(items, moving, before));
  };

  it('moves a block past one neighbour', () => {
    expect(step(['b', 'c'], 1)).toBe('adbc');
    expect(step(['b', 'c'], -1)).toBe('bcad');
    expect(step(['a'], 1)).toBe('bacd');
  });

  it('stops at the ends', () => {
    expect(step(['a', 'b'], -1)).toBe('none');
    expect(step(['c', 'd'], 1)).toBe('none');
    expect(step(['zz'], 1)).toBe('none');
  });

  it('gathers a scattered selection as it moves', () => {
    expect(step(['a', 'c'], 1)).toBe('bacd');
    expect(step(['b', 'd'], -1)).toBe('bdac');
  });
});

describe('groupFields', () => {
  const t = { when_date: null, evening: 0 } as unknown as Task;
  const day = '2026-10-19';

  it('reorders within a group of a sorted list, never in the Logbook', () => {
    expect(groupFields('inbox', 'inbox', 'inbox', t, day)).toEqual({});
    expect(groupFields('logbook', '2026-10-19', '2026-10-19', t, day)).toBeNull();
    expect(canReorder('logbook')).toBe(false);
    expect(canReorder('project')).toBe(true);
  });

  it('Today ↔ This Evening', () => {
    expect(groupFields('today', 'today', 'evening', t, day)).toEqual({ evening: 1, when_date: day });
    const dated = { ...t, when_date: '2026-10-01' } as Task;
    expect(groupFields('today', 'today', 'evening', dated, day)).toEqual({ evening: 1, when_date: '2026-10-01' });
    expect(groupFields('today', 'evening', 'today', dated, day)).toEqual({ evening: 0 });
  });

  it('Upcoming and This Week day groups set the date', () => {
    expect(groupFields('upcoming', '2026-10-20', '2026-10-22', t, day)).toEqual({ when_date: '2026-10-22', someday: 0, evening: 0 });
    expect(groupFields('week', '2026-10-20', 'nope', t, day)).toBeNull();
  });

  it('project headings and matrix quadrants', () => {
    expect(groupFields('project', 'p-loose', 'h1', t, day)).toEqual({ heading_id: 'h1' });
    expect(groupFields('project', 'h1', 'p-loose', t, day)).toEqual({ heading_id: null });
    expect(groupFields('matrix', 'drop', 'do', t, day)).toEqual({ urgent: 1, important: 1 });
    expect(groupFields('matrix', 'do', 'delegate', t, day)).toEqual({ urgent: 1, important: 0 });
  });

  it('refuses moving between project groups of Anytime / Area / Tag', () => {
    expect(groupFields('anytime', 'loose', 'p1', t, day)).toBeNull();
    expect(groupFields('area', 'p1', 'p2', t, day)).toBeNull();
  });
});
