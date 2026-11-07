/**
 * Where a project lands when it's dragged in the sidebar (#126): into an area, between areas, out
 * of any area, or into and out of the Idle section. Pure, so the store and the drag code share it
 * and it can be tested on its own.
 */
import { moveBlock } from './selection';
import type { ID, Project, ProjectStatus } from './types';

/** A drop spot in the sidebar: in `area` (null = no area), just before project `before` (null = at the end). */
export interface ProjectSlot {
  area: ID | null;
  before: ID | null;
  /** In the Idle section, which spans areas: `area` is ignored and the project keeps its own. */
  idle?: boolean;
}

export const isIdle = (p: Project) => p.status === 'idle';

/**
 * The fields to write for dropping project `id` at `slot`, or null when the drop is invalid or
 * would change nothing (unknown or completed project, unknown area, dropping it where it already is).
 * Dropping into the Idle section makes the project idle; dropping an idle one anywhere else makes it
 * active (`status` is only in the result when it changes).
 */
export function projectDrop(
  projects: Project[],
  areaIds: ID[],
  id: ID,
  slot: ProjectSlot,
): { area_id: ID | null; sort: number; status?: ProjectStatus | null } | null {
  const p = projects.find((x) => x.id === id);
  if (!p || p.completed_at) return null;
  const idle = !!slot.idle;
  if (!idle && slot.area !== null && !areaIds.includes(slot.area)) return null;
  const inList = (x: Project) => !x.completed_at && isIdle(x) === idle && (idle || (x.area_id ?? null) === slot.area);
  // The open projects of the destination, in sidebar order.
  const list = projects.filter(inList).sort((a, b) => a.sort - b.sort);
  if (slot.before !== null && !list.some((x) => x.id === slot.before)) return null;
  if (inList(p)) {
    // Same list: a no-op when it would land where it is.
    const i = list.findIndex((x) => x.id === id);
    const next = list[i + 1]?.id ?? null;
    if (slot.before === id || slot.before === next) return null;
  }
  const [placed] = moveBlock(list, [id], slot.before);
  const area_id = idle ? (p.area_id ?? null) : slot.area;
  return isIdle(p) === idle ? { area_id, sort: placed.sort } : { area_id, sort: placed.sort, status: idle ? 'idle' : null };
}
