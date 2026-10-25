/**
 * Touch swipe on a to-do row. Letting go past the commit point opens a small sheet (SwipeSheet):
 * right offers Complete (or Mark as not done) and Move, left offers Move to Trash. Nothing happens
 * without a tap there. Only on touch screens; it never starts in selection mode, on an open row,
 * from a text field, or at a screen edge. A long-press still picks the row up for dragging
 * (drag.svelte.ts).
 */
import type { Attachment } from 'svelte/attachments';
import { store } from '../store.svelte';
import { classifyRowSwipe, rowSwipeOffset, swipeFromEdge, swipeIgnored, type RowSwipe } from '../gesture';
import { isTouch } from '../env';
import { drag } from './drag.svelte';
import type { ID } from '../types';

/** Horizontal travel before a touch counts as a swipe rather than a tap or scroll. */
const LOCK_PX = 10;

function findTouch(list: TouchList, identifier: number): Touch | null {
  for (let i = 0; i < list.length; i++) if (list[i].identifier === identifier) return list[i];
  return null;
}

export function swipeable(id: ID): Attachment<HTMLElement> {
  return (node) => {
    if (!isTouch) return;
    let s: { x: number; y: number; touch: number; locked: boolean; act: RowSwipe } | null = null;
    const row = () => node.querySelector<HTMLElement>(':scope > .row');

    function reset() {
      s = null;
      node.removeAttribute('data-swipe');
      const r = row();
      if (r?.style.transform) {
        r.style.transition = 'transform 0.18s var(--ease)';
        r.style.transform = '';
      }
    }

    // Drop the snap-back transition once it has run, so the row carries no leftover inline style.
    function settled(e: TransitionEvent) {
      if (e.propertyName === 'transform' && e.target === row()) (e.target as HTMLElement).style.transition = '';
    }

    function start(e: TouchEvent) {
      if (s) {
        // A second finger: not a swipe.
        if (e.touches.length > 1) reset();
        return;
      }
      if (e.touches.length !== 1 || !store.canMulti || store.selecting || store.expandedId === id || swipeIgnored(e.target)) return;
      const t = e.touches[0];
      if (swipeFromEdge(t.clientX, window.innerWidth)) return;
      s = { x: t.clientX, y: t.clientY, touch: t.identifier, locked: false, act: null };
    }

    function move(e: TouchEvent) {
      if (!s) return;
      if (e.touches.length !== 1 || drag.active || store.selecting) return reset();
      const t = findTouch(e.touches, s.touch);
      if (!t) return reset();
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (!s.locked) {
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
        r.style.transform = `translateX(${rowSwipeOffset(dx, node.clientWidth * 0.5)}px)`;
      }
      const act = classifyRowSwipe(dx);
      if (act && act !== s.act) navigator.vibrate?.(8); // crossed the point where letting go opens the sheet
      s.act = act;
      const side = dx > 0 ? 'right' : 'left';
      node.setAttribute('data-swipe', act ? side : `hint-${side}`);
    }

    function end(e: TouchEvent) {
      if (!s) return;
      const t = findTouch(e.changedTouches, s.touch);
      if (!t) return; // another finger lifted
      const act = s.locked ? classifyRowSwipe(t.clientX - s.x) : null;
      const swiped = s.locked;
      reset();
      if (swiped) drag.endedAt = Date.now(); // the click after a swipe is not a tap
      if (act) {
        store.swipeSheet = { id, side: act };
        store.overlay = 'swipe';
      }
    }

    node.addEventListener('touchstart', start, { passive: true });
    node.addEventListener('touchmove', move, { passive: false });
    node.addEventListener('touchend', end);
    node.addEventListener('touchcancel', reset);
    node.addEventListener('transitionend', settled);
    return () => {
      node.removeEventListener('touchstart', start);
      node.removeEventListener('touchmove', move);
      node.removeEventListener('touchend', end);
      node.removeEventListener('touchcancel', reset);
      node.removeEventListener('transitionend', settled);
    };
  };
}
