/**
 * Where a project lands when it's dragged in the sidebar (#126): into an area, between areas, or
 * out of any area. Pure, so the store and the drag code share it and it can be tested on its own.
 */
import { moveBlock } from './selection';
import type { ID, Project } from './types';

/** A drop spot in the sidebar: in `area` (null = no area), just before project `before` (null = at the end). */
export interface ProjectSlot {
  area: ID | null;
  before: ID | null;
}

/**
 * The fields to write for dropping project `id` at `slot`, or null when the drop is invalid or
 * would change nothing (unknown or completed project, unknown area, dropping it where it already is).
 */
export function projectDrop(
  projects: Project[],
  areaIds: ID[],
  id: ID,
  slot: ProjectSlot,
): { area_id: ID | null; sort: number } | null {
  const p = projects.find((x) => x.id === id);
  if (!p || p.completed_at) return null;
  if (slot.area !== null && !areaIds.includes(slot.area)) return null;
  // The open projects of the destination, in sidebar order.
  const list = projects.filter((x) => (x.area_id ?? null) === slot.area && !x.completed_at).sort((a, b) => a.sort - b.sort);
  if (slot.before !== null && !list.some((x) => x.id === slot.before)) return null;
  if ((p.area_id ?? null) === slot.area) {
    // Same list: a no-op when it would land where it is.
    const i = list.findIndex((x) => x.id === id);
    const next = list[i + 1]?.id ?? null;
    if (slot.before === id || slot.before === next) return null;
  }
  const [placed] = moveBlock(list, [id], slot.before);
  return { area_id: slot.area, sort: placed.sort };
}
