/**
 * Dragging areas, projects and to-dos onto the Time Blocking calendar (#99). Same pointer-event
 * approach as `drag.svelte.ts` (mouse: press and move; touch: long-press, then move; Escape
 * cancels). While something is over the calendar, `calDrop.slot` is where its block would land;
 * the calendar draws that as a preview. What the block becomes is `sourceBlock` in timeblocks.ts.
 *
 * Sources: area rows in the sidebar (`calendarDraggable`), the calendar's To-dos panel
 * (`calendarDraggable`), and project rows, whose existing sidebar drag (`projectDrag.svelte.ts`)
 * also drops here through `trackCalendar` / `dropOnCalendar`.
 */
import type { Attachment } from 'svelte/attachments';
import { store } from '../store.svelte';
import { isNarrow } from '../env';
import * as TB from '../timeblocks';
import { drag, LONG_PRESS_MS } from './drag.svelte';

/** Pixels per hour on the calendar grid (TimeBlockView uses the same). */
export const HOUR_PX = 48;

export const calDrop = $state({
  active: false,
  source: null as TB.BlockSource | null,
  x: 0,
  y: 0,
  /** Where the block lands if dropped now; null when not over the calendar. */
  slot: null as { day: string; start: number; end: number } | null,
});

const DRAG_PX = 5;
const TOUCH_SLOP = 8;
const EDGE = 40;

/** The day and minute under a point on the calendar: a grid column, or a 4-week cell (9:00). */
function pointAt(x: number, y: number): { day: string; at: number } | null {
  if (store.view.kind !== 'timeblock') return null;
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.cal [data-day]');
  if (!el) return null;
  if (el.dataset.grid === undefined) return { day: el.dataset.day!, at: 9 * 60 };
  const r = el.getBoundingClientRect();
  return { day: el.dataset.day!, at: Math.max(0, (y - r.top) / (HOUR_PX / 60)) };
}

/** Follow a drag of `src` at (x, y). Returns true while it's over the calendar. */
export function trackCalendar(src: TB.BlockSource, x: number, y: number): boolean {
  if (store.view.kind !== 'timeblock') return false;
  if (!calDrop.active) {
    calDrop.active = true;
    calDrop.source = src;
    autoScroll();
  }
  calDrop.x = x;
  calDrop.y = y;
  // Phone: the list drawer covers the calendar; leaving it closes it so the drop can land.
  if (isNarrow() && store.sidebarOpen && x > 260) store.sidebarOpen = false;
  const p = pointAt(x, y);
  calDrop.slot = p ? { day: p.day, ...TB.dropSpan(p.at, TB.sourceMinutes(src, store.tasks)) } : null;
  return !!calDrop.slot;
}

/** End a drag: makes the block if it was over the calendar. Returns true when it did. */
export function dropOnCalendar(): boolean {
  const { source, slot } = calDrop;
  resetCalendar();
  if (!source || !slot) return false;
  return !!store.dropOnCalendar(source, slot.day, slot.start);
}

export function resetCalendar() {
  calDrop.active = false;
  calDrop.source = null;
  calDrop.slot = null;
  cancelAnimationFrame(raf);
}

let raf = 0;
/** Scroll the time grid while the pointer is near its top or bottom edge. */
function autoScroll() {
  cancelAnimationFrame(raf);
  if (!calDrop.active) return;
  const grid = document.querySelector<HTMLElement>('.cal .grid-scroll');
  if (grid) {
    const r = grid.getBoundingClientRect();
    const inside = calDrop.x >= r.left && calDrop.x <= r.right;
    const dy = !inside ? 0 : calDrop.y < r.top + EDGE + 36 ? -1 : calDrop.y > r.bottom - EDGE ? 1 : 0;
    if (dy && calDrop.source) {
      grid.scrollBy(0, dy * 8);
      trackCalendar(calDrop.source, calDrop.x, calDrop.y);
    }
  }
  raf = requestAnimationFrame(autoScroll);
}

/**
 * Attach to anything that can be dropped on the calendar: `{@attach calendarDraggable(src)}`.
 * `when` gates it (the sidebar's area rows only drag while the calendar is open).
 */
export function calendarDraggable(src: TB.BlockSource, when: () => boolean = () => true): Attachment<HTMLElement> {
  return (node) => {
    let start: { x: number; y: number; pointerId: number; mouse: boolean } | null = null;
    let armed = false;
    let moving = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function down(e: PointerEvent) {
      if (e.button !== 0 || !e.isPrimary || drag.active || calDrop.active || !when()) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, [data-no-drag]')) return;
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
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', key, true);
    }

    function move(e: PointerEvent) {
      if (!start || e.pointerId !== start.pointerId) return;
      if (!moving) {
        const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
        if (!armed) {
          if (dist > TOUCH_SLOP) finish(); // it's a scroll
          return;
        }
        if (dist < DRAG_PX) return;
        moving = true;
        document.documentElement.classList.add('dragging');
      }
      trackCalendar(src, e.clientX, e.clientY);
    }

    function up(e: PointerEvent) {
      if (!start || e.pointerId !== start.pointerId) return;
      const dropped = moving;
      finish(dropped);
      if (dropped) dropOnCalendar();
    }

    function key(e: KeyboardEvent) {
      if (e.key === 'Escape' && moving) {
        e.preventDefault();
        e.stopPropagation();
        finish();
      }
    }

    const cancel = () => finish();

    /** Stop following the pointer; `keep` leaves the drop target for dropOnCalendar to use. */
    function finish(keep = false) {
      clearTimeout(timer);
      if (moving || (armed && start && !start.mouse)) drag.endedAt = Date.now();
      if (!keep) resetCalendar();
      start = null;
      armed = false;
      moving = false;
      document.documentElement.classList.remove('dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
    }

    function touchmove(e: TouchEvent) {
      if (armed && start && !start.mouse && e.cancelable) e.preventDefault();
    }
    function contextmenu(e: Event) {
      if (start && !start.mouse && armed) e.preventDefault();
    }
    // Swallow the click (open the list) that follows a drag or long-press.
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
