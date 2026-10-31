/** Optional features the user can turn on or off in Settings → Features. Saved per device. */

export type FeatureId = 'dump' | 'week' | 'timeblock';

export const FEATURES: { id: FeatureId; label: string; icon: string; description: string; default: boolean }[] = [
  {
    id: 'dump',
    label: 'Brain Dump',
    icon: 'dump',
    description: 'A scratch list where unchecked items fade and are deleted after 48 hours.',
    default: true,
  },
  {
    id: 'week',
    label: 'This Week',
    icon: 'week',
    description: 'A list of everything scheduled or due from today through Sunday, grouped by day.',
    default: false,
  },
  {
    id: 'timeblock',
    label: 'Time Blocking',
    icon: 'timeblock',
    description: 'A calendar for planning blocks of time for an area, project or to-do. Day, 3 days, 7 days or 4 weeks. Other calendars can subscribe to it.',
    default: true,
  },
];

const KEY = 'openthings.features';

function load(): Record<FeatureId, boolean> {
  const out = Object.fromEntries(FEATURES.map((f) => [f.id, f.default])) as Record<FeatureId, boolean>;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<FeatureId, unknown>>;
    for (const f of FEATURES) if (typeof saved[f.id] === 'boolean') out[f.id] = saved[f.id] as boolean;
  } catch {
    /* ignore */
  }
  return out;
}

class Features {
  on = $state(load());

  enabled(id: FeatureId): boolean {
    return this.on[id];
  }

  set(id: FeatureId, value: boolean) {
    this.on[id] = value;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.on));
    } catch {
      /* ignore */
    }
  }
}

export const features = new Features();

/** View kinds that only exist while their feature is on. */
export function viewEnabled(kind: string): boolean {
  if (kind === 'dump') return features.enabled('dump');
  if (kind === 'week') return features.enabled('week');
  if (kind === 'timeblock') return features.enabled('timeblock');
  return true;
}
