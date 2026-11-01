/**
 * Pointer drag for the things that aren't to-do rows or sidebar projects: areas in the sidebar,
 * headings in a project, checklist items in an open to-do. Same gestures as `drag.svelte.ts` and
 * `projectDrag.svelte.ts` (mouse: press and move; touch: long-press, then move; Escape cancels;
 * the click after a drag is swallowed). Each use supplies where a point lands (`slotAt`, null =
 * nowhere valid) and what a drop does; the rules live in `dragRules.ts` and the store.
 */
import type { Attachment } from 'svelte/attachments';
import { drag, LONG_PRESS_MS, viewKey } from './drag.svelte';
import { projectDrag } from './projectDrag.svelte';
import type { ID, ViewKey } from '../types';

export type SortKind = 'area' | 'heading' | 'checklist';

/** Where a drop lands: before an item in its own list (null: the end), on a sidebar list, or on the task list. */
export type SortSlot =
  | { kind: 'before'; before: ID | null }
  | { kind: 'view'; view: ViewKey }
  | { kind: 'tasks' };

export const sortDrag = $state({
  active: false,
  kind: null as SortKind | null,
  id: null as ID | null,
  label: '',
  x: 0,
  y: 0,
  slot: null as SortSlot | null,
});

const DRAG_PX = 5;
const TOUCH_SLOP = 8;

/** Is the drop line just before `before` (null: at the end) in a `kind` list? */
export function sortLine(kind: SortKind, before: ID | null): boolean {
  const s = sortDrag.slot;
  return sortDrag.active && sortDrag.kind === kind && s?.kind === 'before' && s.before === before;
}

/** Is sidebar list `v` the target of the current drag? */
export function sortOn(v: ViewKey): boolean {
  const s = sortDrag.slot;
  return sortDrag.active && s?.kind === 'view' && viewKey(s.view) === viewKey(v);
}

/** The sidebar list under a point, if any. */
export function viewAt(x: number, y: number): ViewKey | null {
  const nav = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-view]');
  return nav ? (JSON.parse(nav.dataset.dropView!) as ViewKey) : null;
}

/** Of `rows` (in order), the id a point at `y` over `row` drops before (null: after the last). */
export function beforeAt(rows: HTMLElement[], row: HTMLElement, y: number, attr: string): ID | null {
  const r = row.getBoundingClientRect();
  const i = rows.indexOf(row);
  const target = y < r.top + r.height / 2 ? rows[i] : rows[i + 1];
  return target?.getAttribute(attr) ?? null;
}

export interface SortableOptions {
  kind: SortKind;
  id: ID;
  label: () => string;
  /** The valid drop spot under a point, or null. */
  slotAt: (x: number, y: number) => SortSlot | null;
  drop: (slot: SortSlot) => void;
  /** Presses starting inside these elements don't drag (buttons, inputs). */
  skip?: string;
}

export function sortable(o: SortableOptions): Attachment<HTMLElement> {
  return (node) => {
    let start: { x: number; y: number; pointerId: number; mouse: boolean } | null = null;
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function down(e: PointerEvent) {
      if (e.button !== 0 || !e.isPrimary || drag.active || projectDrag.active || sortDrag.active) return;
      if (o.skip && (e.target as Element).closest(o.skip)) return;
      // Only the innermost sortable handles a press (a checklist item inside a heading's project).
      e.stopPropagation();
      const mouse = e.pointerType === 'mouse';
      start = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, mouse };
      armed = mouse;
      if (!mouse) {
        timer = setTimeout(() => {
          armed = true;
          navigator.vibrate?.(8);
        }, LONG_PRESS_MS);
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', finish);
      window.addEventListener('keydown', key, true);
    }

    function move(e: PointerEvent) {
      if (!start || e.pointerId !== start.pointerId) return;
      if (!sortDrag.active) {
        const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
        if (!armed) {
          if (dist > TOUCH_SLOP) finish(); // it's a scroll
          return;
        }
        if (dist < DRAG_PX) return;
        sortDrag.active = true;
        sortDrag.kind = o.kind;
        sortDrag.id = o.id;
        sortDrag.label = o.label();
        document.documentElement.classList.add('dragging');
        window.getSelection()?.removeAllRanges();
      }
      sortDrag.x = e.clientX;
      sortDrag.y = e.clientY;
      sortDrag.slot = o.slotAt(e.clientX, e.clientY);
    }

    function up(e: PointerEvent) {
      if (!start || e.pointerId !== start.pointerId) return;
      const slot = sortDrag.active ? sortDrag.slot : null;
      finish();
      if (slot) o.drop(slot);
    }

    function key(e: KeyboardEvent) {
      if (e.key === 'Escape' && sortDrag.active) {
        e.preventDefault();
        e.stopPropagation();
        finish();
      }
    }

    function finish() {
      clearTimeout(timer);
      if (sortDrag.active || (armed && start && !start.mouse)) drag.endedAt = Date.now();
      start = null;
      armed = false;
      sortDrag.active = false;
      sortDrag.kind = null;
      sortDrag.id = null;
      sortDrag.slot = null;
      document.documentElement.classList.remove('dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('keydown', key, true);
    }

    function touchmove(e: TouchEvent) {
      if (armed && start && !start.mouse && e.cancelable) e.preventDefault();
    }
    function contextmenu(e: Event) {
      if (start && !start.mouse && armed) e.preventDefault();
    }
    function click(e: MouseEvent) {
      if (Date.now() - drag.endedAt < 400) {
        e.stopPropagation();
        e.preventDefault();
      }
    }

    node.addEventListener('pointerdown', down);
    node.addEventListener('touchmove', touchmove, { passive: false });
    node.addEventListener('contextmenu', contextmenu);
    node.addEventListener('click', click, true);
    return () => {
      if (start) finish();
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('touchmove', touchmove);
      node.removeEventListener('contextmenu', contextmenu);
      node.removeEventListener('click', click, true);
    };
  };
}
