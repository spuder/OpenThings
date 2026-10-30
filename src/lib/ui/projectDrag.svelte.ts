/**
 * Drag and drop for projects in the sidebar (#126): into an area, between areas, out of any area,
 * and reordering. Same pointer-event approach as the to-do drag in `drag.svelte.ts` (mouse: press
 * and move; touch: long-press, then move; Escape cancels). Where a project may land is decided by
 * `projectDrop` in `projectMove.ts`; this file only tracks the pointer and the drop indicator.
 */
import type { Attachment } from 'svelte/attachments';
import { store } from '../store.svelte';
import { projectDrop, type ProjectSlot } from '../projectMove';
import { drag, LONG_PRESS_MS } from './drag.svelte';
import type { ID } from '../types';

export const projectDrag = $state({
  active: false,
  id: null as ID | null,
  /** The valid spot under the pointer, or null (nothing there, or a drop that isn't allowed). */
  slot: null as ProjectSlot | null,
});

const DRAG_PX = 5;
const TOUCH_SLOP = 8;

/** Is the drop line just before project `before` in `area` (before null: at the end of that list)? */
export function projectDropLine(area: ID | null, before: ID | null): boolean {
  const s = projectDrag.slot;
  return projectDrag.active && !!s && s.area === area && s.before === before;
}

/** The spot under a point in the sidebar, if dropping the dragged project there is allowed. */
export function slotAt(x: number, y: number, id: ID): ProjectSlot | null {
  const el = document.elementFromPoint(x, y);
  const list = el?.closest<HTMLElement>('[data-project-list]');
  if (!el || !list) return null;
  const area = list.dataset.projectList || null;
  const rows = [...list.querySelectorAll<HTMLElement>('[data-project-id]')];
  let slot: ProjectSlot;
  if (el.closest('[data-area-head]')) {
    // On the area's own row: into the area, at the top.
    slot = { area, before: rows[0]?.dataset.projectId ?? null };
  } else {
    const row = el.closest<HTMLElement>('[data-project-id]');
    if (row) {
      const r = row.getBoundingClientRect();
      const i = rows.indexOf(row);
      const target = y < r.top + r.height / 2 ? rows[i] : rows[i + 1];
      slot = { area, before: target?.dataset.projectId ?? null };
    } else slot = { area, before: null };
  }
  return projectDrop(store.projects, store.areas.map((a) => a.id), id, slot) ? slot : null;
}

/** Attach to a project's sidebar row: `{@attach projectDraggable(p.id)}`. */
export function projectDraggable(id: ID): Attachment<HTMLElement> {
  return (node) => {
    let start: { x: number; y: number; pointerId: number; mouse: boolean } | null = null;
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function down(e: PointerEvent) {
      if (e.button !== 0 || !e.isPrimary || drag.active) return;
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
      if (!projectDrag.active) {
        const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
        if (!armed) {
          if (dist > TOUCH_SLOP) finish(); // it's a scroll
          return;
        }
        if (dist < DRAG_PX) return;
        projectDrag.active = true;
        projectDrag.id = id;
        document.documentElement.classList.add('dragging');
      }
      projectDrag.slot = slotAt(e.clientX, e.clientY, id);
    }

    function up(e: PointerEvent) {
      if (!start || e.pointerId !== start.pointerId) return;
      const slot = projectDrag.active ? projectDrag.slot : null;
      finish();
      if (slot) store.dropProject(id, slot);
    }

    function key(e: KeyboardEvent) {
      if (e.key === 'Escape' && projectDrag.active) {
        e.preventDefault();
        e.stopPropagation();
        finish();
      }
    }

    function finish() {
      clearTimeout(timer);
      if (projectDrag.active || (armed && start && !start.mouse)) drag.endedAt = Date.now();
      start = null;
      armed = false;
      projectDrag.active = false;
      projectDrag.id = null;
      projectDrag.slot = null;
      document.documentElement.classList.remove('dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('keydown', key, true);
    }

    // Once a touch has been held, moving it drags instead of scrolling the sidebar.
    function touchmove(e: TouchEvent) {
      if (armed && start && !start.mouse && e.cancelable) e.preventDefault();
    }
    function contextmenu(e: Event) {
      if (start && !start.mouse && armed) e.preventDefault();
    }
    // Swallow the click (open the project) that follows a drag or long-press.
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
