/**
 * Touch swipe on a to-do row: right completes it, left moves it to the Trash (undo is offered by
 * the toast). Only on touch screens; it never starts in selection mode, on an open row, or from a
 * text field. A long-press still picks the row up for dragging (drag.svelte.ts).
 */
import type { Attachment } from 'svelte/attachments';
import { store } from '../store.svelte';
import { classifyRowSwipe, swipeIgnored } from '../gesture';
import { isTouch } from '../env';
import { drag } from './drag.svelte';
import type { ID } from '../types';

/** Horizontal travel before a touch counts as a swipe rather than a tap or scroll. */
const LOCK_PX = 10;

export function swipeable(id: ID): Attachment<HTMLElement> {
  return (node) => {
    if (!isTouch) return;
    let s: { x: number; y: number; locked: boolean | null } | null = null;
    const row = () => node.querySelector<HTMLElement>('.row');

    function reset() {
      s = null;
      node.removeAttribute('data-swipe');
      const r = row();
      if (r) {
        r.style.transition = 'transform 0.18s var(--ease)';
        r.style.transform = '';
      }
    }

    function start(e: TouchEvent) {
      if (e.touches.length !== 1 || !store.canMulti || store.selecting || store.expandedId === id || swipeIgnored(e.target)) return;
      s = { x: e.touches[0].clientX, y: e.touches[0].clientY, locked: null };
    }
    function move(e: TouchEvent) {
      if (!s) return;
      if (drag.active || store.selecting) return reset();
      const dx = e.touches[0].clientX - s.x;
      const dy = e.touches[0].clientY - s.y;
      if (s.locked === null) {
        if (Math.abs(dy) > LOCK_PX && Math.abs(dy) > Math.abs(dx)) {
          s = null; // a scroll
          return;
        }
        if (Math.abs(dx) <= LOCK_PX) return;
        s.locked = true;
      }
      if (e.cancelable) e.preventDefault();
      const r = row();
      if (r) {
        r.style.transition = 'none';
        r.style.transform = `translateX(${dx}px)`;
      }
      const act = classifyRowSwipe(dx);
      node.setAttribute('data-swipe', act ?? (dx > 0 ? 'hint-complete' : 'hint-delete'));
    }
    function end(e: TouchEvent) {
      if (!s) return;
      const act = s.locked ? classifyRowSwipe(e.changedTouches[0].clientX - s.x) : null;
      const swiped = !!s.locked;
      reset();
      if (swiped) drag.endedAt = Date.now(); // the click after a swipe is not a tap
      if (act === 'complete') store.toggleComplete(id);
      else if (act === 'delete') store.deleteTask(id);
    }

    node.addEventListener('touchstart', start, { passive: true });
    node.addEventListener('touchmove', move, { passive: false });
    node.addEventListener('touchend', end);
    node.addEventListener('touchcancel', reset);
    return () => {
      node.removeEventListener('touchstart', start);
      node.removeEventListener('touchmove', move);
      node.removeEventListener('touchend', end);
      node.removeEventListener('touchcancel', reset);
    };
  };
}
