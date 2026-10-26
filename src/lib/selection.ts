/**
 * Multi-select and multi-item reordering. Pure so it can be unit tested; the store holds the state.
 *
 * A selection is a set of ids plus an anchor (where a Shift range starts) and a cursor (the row
 * the keyboard is on, which is also `store.selectedId`). `order` is always the visible row order.
 */
import type { ID, Task, ViewKey } from './types';

export interface Selection {
  ids: ID[];
  anchor: ID | null;
  cursor: ID | null;
}

export const EMPTY: Selection = { ids: [], anchor: null, cursor: null };

/** Ids in the order they appear in `order`, without duplicates or ids that aren't visible. */
export function inOrder(ids: Iterable<ID>, order: ID[]): ID[] {
  const set = new Set(ids);
  return order.filter((id) => set.has(id));
}

/** Plain click: just this row. */
export function selectOnly(id: ID): Selection {
  return { ids: [id], anchor: id, cursor: id };
}

/** ⌘/Ctrl click or a tap in selection mode: add or remove one row. The anchor moves to it. */
export function toggle(sel: Selection, id: ID, order: ID[]): Selection {
  const has = sel.ids.includes(id);
  const ids = has ? sel.ids.filter((x) => x !== id) : inOrder([...sel.ids, id], order);
  return { ids, anchor: id, cursor: has ? (ids.at(-1) ?? null) : id };
}

/** Rows from `a` to `b` inclusive, in visible order. */
function span(a: ID, b: ID, order: ID[]): ID[] {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i < 0 || j < 0) return j >= 0 ? [b] : [];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** Shift click: everything from the anchor to `id`. Without an anchor it starts at `id`. */
export function range(sel: Selection, id: ID, order: ID[]): Selection {
  const anchor = sel.anchor && order.includes(sel.anchor) ? sel.anchor : id;
  return { ids: span(anchor, id, order), anchor, cursor: id };
}

/** Shift+arrow: move the cursor by `delta` rows and select from the anchor to it. */
export function extend(sel: Selection, delta: number, order: ID[]): Selection {
  if (!order.length) return sel;
  const cursor = sel.cursor && order.includes(sel.cursor) ? sel.cursor : null;
  if (!cursor) {
    const start = delta > 0 ? order[0] : order[order.length - 1];
    return selectOnly(start);
  }
  const anchor = sel.anchor && order.includes(sel.anchor) ? sel.anchor : cursor;
  const i = order.indexOf(cursor);
  const next = order[Math.max(0, Math.min(order.length - 1, i + delta))];
  return { ids: span(anchor, next, order), anchor, cursor: next };
}

/** Every visible row. */
export function selectAll(order: ID[], cursor: ID | null): Selection {
  if (!order.length) return EMPTY;
  return { ids: [...order], anchor: order[0], cursor: cursor && order.includes(cursor) ? cursor : order[0] };
}

/** Drop rows that are no longer visible (moved to another list, deleted…). */
export function prune(sel: Selection, order: ID[]): Selection {
  const ids = inOrder(sel.ids, order);
  if (ids.length === sel.ids.length && (!sel.cursor || order.includes(sel.cursor))) return sel;
  const cursor = sel.cursor && ids.includes(sel.cursor) ? sel.cursor : (ids.at(-1) ?? null);
  const anchor = sel.anchor && order.includes(sel.anchor) ? sel.anchor : (ids[0] ?? null);
  return { ids, anchor, cursor };
}

// ---------- moving several to-dos at once ----------

type Sorted = Pick<Task, 'id' | 'sort'>;

/**
 * New `sort` values that place `moving` together, in their current order, just before `beforeId`
 * in `items` (a list sorted by `sort`). `beforeId` null means the end of the list. If `beforeId` is
 * one of the moving rows, the block lands before the next row that isn't moving.
 *
 * Only moving rows get new values; everything else keeps its sort, so the change is as small as the op log allows.
 * Rows from `moving` that aren't in `items` (dragged in from another group) go in too, after the ones that are.
 */
export function moveBlock(items: Sorted[], moving: ID[], beforeId: ID | null): { id: ID; sort: number }[] {
  const set = new Set(moving);
  if (!set.size) return [];
  const present = items.filter((t) => set.has(t.id)).map((t) => t.id);
  const block = [...present, ...moving.filter((id) => !present.includes(id))];
  const rest = items.filter((t) => !set.has(t.id));

  // Where the block goes in `rest`.
  let at = rest.length;
  if (beforeId !== null) {
    const i = items.findIndex((t) => t.id === beforeId);
    if (i >= 0) {
      const after = items.slice(i).find((t) => !set.has(t.id));
      at = after ? rest.indexOf(after) : rest.length;
    }
  }
  const lo = rest[at - 1]?.sort;
  const hi = rest[at]?.sort;
  const n = block.length;
  return block.map((id, k) => {
    let sort: number;
    if (lo !== undefined && hi !== undefined) sort = lo + ((hi - lo) * (k + 1)) / (n + 1);
    else if (lo !== undefined) sort = lo + k + 1;
    else if (hi !== undefined) sort = hi - (n - k);
    else sort = k;
    return { id, sort };
  });
}

/**
 * Keyboard move (⌥↑ / ⌥↓) for a block: the id to drop the selection before so it passes one
 * neighbour, or undefined when it's already at that end. null means "at the end".
 */
export function stepTarget(items: Sorted[], moving: ID[], dir: -1 | 1): ID | null | undefined {
  const set = new Set(moving);
  const rest = items.filter((t) => !set.has(t.id));
  const first = items.findIndex((t) => set.has(t.id));
  if (first < 0) return undefined;
  // Position of the block in `rest` now: the number of other rows above its first row.
  const at = items.slice(0, first).filter((t) => !set.has(t.id)).length;
  const to = at + dir;
  if (to < 0 || to > rest.length) return undefined;
  return rest[to]?.id ?? null;
}

// ---------- dropping into another group of the same list ----------

/** Lists whose rows are ordered by `sort`, so dragging can reorder them. Logbook is by completion date. */
export function canReorder(kind: ViewKey['kind']): boolean {
  return ['inbox', 'today', 'week', 'upcoming', 'anytime', 'someday', 'project', 'area', 'tag', 'matrix'].includes(kind);
}

/**
 * Fields a to-do takes on when it's dropped into group `toKey` of a list, coming from group `fromKey`.
 * `{}` = just reorder; null = that group doesn't accept it (the drop is refused).
 */
export function groupFields(kind: ViewKey['kind'], fromKey: string, toKey: string, t: Task, day: string): Partial<Task> | null {
  if (!canReorder(kind)) return null;
  if (fromKey === toKey) return {};
  switch (kind) {
    case 'today':
      // This Evening needs a When date; deadline-only rows get today.
      if (toKey === 'evening') return { evening: 1, when_date: t.when_date ?? day };
      if (toKey === 'today') return { evening: 0 };
      return null;
    case 'week':
    case 'upcoming':
      // Day groups are keyed by date.
      return /^\d{4}-\d{2}-\d{2}$/.test(toKey) ? { when_date: toKey, someday: 0, evening: 0 } : null;
    case 'project':
      return { heading_id: toKey === 'p-loose' ? null : toKey };
    case 'matrix': {
      const flags: Record<string, Partial<Task>> = {
        do: { urgent: 1, important: 1 },
        schedule: { urgent: 0, important: 1 },
        delegate: { urgent: 1, important: 0 },
        drop: { urgent: 0, important: 0 },
      };
      return flags[toKey] ?? null;
    }
    default:
      // Anytime / Someday / Area / Tag groups are projects: use Move (M) or drop on the project in the sidebar.
      return null;
  }
}
