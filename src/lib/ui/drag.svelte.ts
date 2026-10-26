/**
 * Drag and drop for to-do rows, mouse and touch, built on pointer events (no HTML5 drag, which
 * iOS Safari doesn't support for this). Dragging a selected row carries the whole selection.
 *
 * Mouse: press and move a few pixels. Touch: long-press (enters selection mode and picks the row),
 * then move without lifting. A drop lands between rows of the list, or on a list in the sidebar
 * (drag to the left edge on a phone to open it). Escape cancels.
 *
 * The decisions (where the block goes, which sort values, what a group or list does to the rows)
 * live in `selection.ts` and the store; this file only tracks the pointer.
 */
import type { Attachment } from 'svelte/attachments';
import { store } from '../store.svelte';
import { canReorder } from '../selection';
import { isNarrow } from '../env';
import type { ID, ViewKey } from '../types';

export type DropTarget =
  | { kind: 'list'; group: string; before: ID | null; ok: boolean }
  | { kind: 'view'; view: ViewKey; key: string; ok: boolean };

export const drag = $state({
  active: false,
  ids: [] as ID[],
  x: 0,
  y: 0,
  target: null as DropTarget | null,
  /** When the last drag ended, so the touch swipe handler and click handlers can ignore its gesture. */
  endedAt: 0,
});

/** Mouse travel before a press becomes a drag. */
const DRAG_PX = 5;
/** Touch: hold this long without moving to pick the row up. */
export const LONG_PRESS_MS = 450;
/** Touch: moving further than this before the long-press fires means scrolling. */
const TOUCH_SLOP = 8;
/** Distance from the scroller edge where dragging scrolls the list. */
const EDGE = 48;

export const viewKey = (v: ViewKey) => ('id' in v ? `${v.kind}:${v.id}` : v.kind);

/** Is the drop line before this row (or at the end of this group when `id` is null)? */
export function dropLine(group: string, id: ID | null): boolean {
  const t = drag.target;
  return drag.active && t?.kind === 'list' && t.ok && t.group === group && t.before === id;
}

/** Is this sidebar list the current drop target? */
export function dropOn(v: ViewKey): 'ok' | 'no' | null {
  const t = drag.target;
  if (!drag.active || t?.kind !== 'view' || t.key !== viewKey(v)) return null;
  return t.ok ? 'ok' : 'no';
}

function hitTest(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const nav = el.closest<HTMLElement>('[data-drop-view]');
  if (nav) {
    const view = JSON.parse(nav.dataset.dropView!) as ViewKey;
    return { kind: 'view', view, key: viewKey(view), ok: store.acceptsDrop(view) };
  }
  const groupEl = el.closest<HTMLElement>('[data-group]');
  if (!groupEl || !canReorder(store.view.kind)) return null;
  const group = groupEl.dataset.group!;
  const items = store.groups.find((g) => g.key === group)?.items ?? [];
  const ok = !!store.dropFields(drag.ids, group);
  const row = el.closest<HTMLElement>('.task[data-id]');
  if (row && groupEl.contains(row)) {
    const r = row.getBoundingClientRect();
    const i = items.findIndex((t) => t.id === row.dataset.id);
    const before = y < r.top + r.height / 2 ? items[i]?.id : items[i + 1]?.id;
    return { kind: 'list', group, before: before ?? null, ok };
  }
  // Over the group's header or empty space: above the first row means the top, otherwise the end.
  const firstRow = groupEl.querySelector<HTMLElement>('.task[data-id]');
  const before = firstRow && y < firstRow.getBoundingClientRect().top ? (items[0]?.id ?? null) : null;
  return { kind: 'list', group, before, ok };
}

let scrollRaf = 0;
/** Scroll the list while the pointer is near its top or bottom edge. */
function autoScroll() {
  cancelAnimationFrame(scrollRaf);
  if (!drag.active) return;
  const scroller = document.querySelector<HTMLElement>('main .scroll');
  if (scroller) {
    const r = scroller.getBoundingClientRect();
    const dy = drag.y < r.top + EDGE ? -1 : drag.y > r.bottom - EDGE ? 1 : 0;
    if (dy) {
      scroller.scrollBy(0, dy * 10);
      drag.target = hitTest(drag.x, drag.y);
    }
  }
  scrollRaf = requestAnimationFrame(autoScroll);
}

/** Attach to a to-do row: `{@attach draggable(task.id)}`. */
export function draggable(id: ID): Attachment<HTMLElement> {
  return (node) => {
    let start: { x: number; y: number; pointerId: number; mouse: boolean } | null = null;
    let armed = false;
    let longPressed = false;
    let openedSidebar = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function down(e: PointerEvent) {
      if (e.button !== 0 || !e.isPrimary || !store.canMulti || store.expandedId === id) return;
      if (e.target instanceof Element && e.target.closest('button, input, textarea, select, a, [data-no-drag]')) return;
      const mouse = e.pointerType === 'mouse';
      start = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, mouse };
      armed = mouse;
      longPressed = false;
      if (!mouse) {
        timer = setTimeout(() => {
          armed = true;
          longPressed = true;
          store.startSelecting(id);
          navigator.vibrate?.(8);
        }, LONG_PRESS_MS);
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', key, true);
    }

    function begin() {
      // Dragging an unselected row drags just that row (and selects it, like a click would).
      if (!store.isPicked(id)) {
        if (store.selecting) store.toggleSelect(id);
        else {
          store.clearMulti();
          store.selectedId = id;
        }
      }
      drag.ids = store.isPicked(id) ? store.actionIds : [id];
      drag.active = true;
      document.documentElement.classList.add('dragging');
      autoScroll();
    }

    function move(e: PointerEvent) {
      if (!start || e.pointerId !== start.pointerId) return;
      const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (!drag.active) {
        if (!armed) {
          if (dist > TOUCH_SLOP) finish(); // it's a scroll
          return;
        }
        if (dist < DRAG_PX) return;
        begin();
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
      // Phone: the sidebar is a drawer; dragging to the left edge opens it so its lists can take the drop.
      if (isNarrow() && !store.sidebarOpen && e.clientX < 24) {
        store.sidebarOpen = true;
        openedSidebar = true;
      }
      drag.target = hitTest(e.clientX, e.clientY);
    }

    function up(e: PointerEvent) {
      if (!start || e.pointerId !== start.pointerId) return;
      const t = drag.target;
      const ids = drag.ids;
      const dropped = drag.active;
      finish();
      if (dropped && t?.ok) {
        if (t.kind === 'list') store.dropInList(ids, t.group, t.before);
        else store.dropOnView(ids, t.view);
      }
    }

    function cancel() {
      finish();
    }

    function key(e: KeyboardEvent) {
      if (e.key === 'Escape' && drag.active) {
        e.preventDefault();
        e.stopPropagation();
        finish();
      }
    }

    function finish() {
      clearTimeout(timer);
      // A long-press or a drag is not also a click / tap on the row.
      if (drag.active || longPressed) drag.endedAt = Date.now();
      if (openedSidebar) store.sidebarOpen = false;
      openedSidebar = false;
      start = null;
      armed = false;
      longPressed = false;
      drag.active = false;
      drag.target = null;
      drag.ids = [];
      cancelAnimationFrame(scrollRaf);
      document.documentElement.classList.remove('dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
    }

    // Once a touch has been held, moving it drags instead of scrolling the list.
    function touchmove(e: TouchEvent) {
      if (armed && start && !start.mouse && e.cancelable) e.preventDefault();
    }
    // No context menu / callout on a long-press.
    function contextmenu(e: Event) {
      if (start && !start.mouse) e.preventDefault();
    }
    // Swallow the click that follows a drag or a long-press.
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
