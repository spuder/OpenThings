<script module lang="ts">
  const colors: Record<string, string> = {
    inbox: 'var(--inbox)',
    today: 'var(--star)',
    upcoming: 'var(--upcoming)',
    week: 'var(--week)',
    anytime: 'var(--anytime)',
    someday: 'var(--someday)',
    logbook: 'var(--logbook)',
    dump: 'var(--dump)',
    habits: 'var(--habits)',
    matrix: 'var(--matrix)',
    trash: 'var(--text-2)',
    settings: 'var(--text-2)',
    gear: 'var(--text-2)',
    bell: 'var(--habits)',
    area: 'var(--text-2)',
    evening: 'var(--evening)',
    // Menu actions (area and project menus)
    rename: 'var(--inbox)',
    add: 'var(--anytime)',
    move: 'var(--anytime)',
    heading: 'var(--matrix)',
    unheading: 'var(--text-2)',
    complete: 'var(--logbook)',
    delete: 'var(--deadline)',
  };

  /** The color an icon is drawn in; menus reuse it for the item's letter. */
  export function iconColor(name: string): string {
    return colors[name] ?? 'var(--text-2)';
  }
</script>

<script lang="ts">
  /** Original line icons for each list. Simple geometric shapes, drawn for this project. */
  let { name, size = 18 }: { name: string; size?: number } = $props();

  const color = $derived(iconColor(name));
</script>

<svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === 'inbox'}
    <path d="M3 11.5 5.2 4.6A1.5 1.5 0 0 1 6.6 3.5h6.8a1.5 1.5 0 0 1 1.4 1.1L17 11.5v3.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15z" />
    <path d="M3 11.5h4l1 2h4l1-2h4" />
  {:else if name === 'today'}
    <path d="M10 2.8l2.1 4.4 4.8.6-3.5 3.3.9 4.8L10 13.6l-4.3 2.3.9-4.8-3.5-3.3 4.8-.6z" fill={color} />
  {:else if name === 'upcoming'}
    <rect x="3" y="4" width="14" height="13" rx="2.5" />
    <path d="M3 8h14M7 2.5v3M13 2.5v3" />
    <circle cx="10" cy="12.5" r="1.4" fill={color} stroke="none" />
  {:else if name === 'week'}
    <rect x="3" y="4" width="14" height="13" rx="2.5" />
    <path d="M3 8h14M7 2.5v3M13 2.5v3" />
    <path d="M6 12.5h8" stroke-width="2.4" />
  {:else if name === 'anytime'}
    <path d="M10 3 17 6.6 10 10.2 3 6.6z" />
    <path d="M3 10.2l7 3.6 7-3.6M3 13.8l7 3.6 7-3.6" />
  {:else if name === 'someday'}
    <rect x="3" y="4" width="14" height="4" rx="1.2" />
    <path d="M4.5 8v7a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5V8M8 11h4" />
  {:else if name === 'logbook'}
    <rect x="3.5" y="3" width="13" height="14" rx="2.5" />
    <path d="M7 10.2l2.2 2.2L13.4 8" />
  {:else if name === 'dump'}
    <path d="M5 3h8l3 3v10.5a.5.5 0 0 1-.5.5h-10.5a.5.5 0 0 1-.5-.5V3.5A.5.5 0 0 1 5 3z" />
    <path d="M7.5 8.5c1.2-.6 2.4.6 3.6 0s2.2-.4 2.4 0M7.5 12c1.2-.6 2.4.6 3.6 0" />
  {:else if name === 'habits'}
    <path d="M10 17c-3 0-5-2-5-4.8 0-3 2.6-4.5 3.2-7.7 2 1.3 2.6 3.3 2.4 4.8 1-.6 1.6-1.7 1.7-2.8 1.7 1.5 2.7 3.4 2.7 5.6C15 15 13 17 10 17z" />
  {:else if name === 'matrix'}
    <rect x="3" y="3" width="6" height="6" rx="1.5" />
    <rect x="11" y="3" width="6" height="6" rx="1.5" />
    <rect x="3" y="11" width="6" height="6" rx="1.5" />
    <rect x="11" y="11" width="6" height="6" rx="1.5" />
  {:else if name === 'evening'}
    <path d="M15.5 12.5A6 6 0 0 1 7.5 4.5a6 6 0 1 0 8 8z" fill={color} />
  {:else if name === 'area'}
    <path d="M10 2.5l6.5 3.5v8L10 17.5 3.5 14V6z" />
  {:else if name === 'repeat'}
    <path d="M4 9a5 5 0 0 1 9-3l1.5 1.5M16 11a5 5 0 0 1-9 3L5.5 12.5" />
    <path d="M14.5 3.5v4h-4M5.5 16.5v-4h4" />
  {:else if name === 'flag'}
    <path d="M5 17V3.5M5 4h9l-2 3.5 2 3.5H5" />
  {:else if name === 'clock'}
    <circle cx="10" cy="10" r="7" />
    <path d="M10 6v4l2.5 1.5" />
  {:else if name === 'note'}
    <path d="M4 5h12M4 9h12M4 13h8" />
  {:else if name === 'checklist'}
    <path d="M4 6l1.3 1.3L7.6 5M10 6.2h6M4 13l1.3 1.3L7.6 12M10 13.2h6" />
  {:else if name === 'sound'}
    <path d="M4 8v4h3l4 3V5L7 8z" />
    <path d="M14 7.5a3.5 3.5 0 0 1 0 5" />
  {:else if name === 'mute'}
    <path d="M4 8v4h3l4 3V5L7 8z" />
    <path d="M14 8l3 4M17 8l-3 4" />
  {:else if name === 'plus' || name === 'add'}
    <path d="M10 4v12M4 10h12" />
  {:else if name === 'gear' || name === 'settings'}
    <path d="M15.98 8.35 L18.09 8.68 L18.09 11.32 L15.98 11.65 L15.39 13.06 L16.66 14.79 L14.79 16.66 L13.06 15.39 L11.65 15.98 L11.32 18.09 L8.68 18.09 L8.35 15.98 L6.94 15.39 L5.21 16.66 L3.34 14.79 L4.61 13.06 L4.02 11.65 L1.91 11.32 L1.91 8.68 L4.02 8.35 L4.61 6.94 L3.34 5.21 L5.21 3.34 L6.94 4.61 L8.35 4.02 L8.68 1.91 L11.32 1.91 L11.65 4.02 L13.06 4.61 L14.79 3.34 L16.66 5.21 L15.39 6.94 Z" stroke-width="1.5" />
    <circle cx="10" cy="10" r="2.4" stroke-width="1.5" />
  {:else if name === 'trash' || name === 'delete'}
    <path d="M4 5.5h12M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M5.5 5.5l.8 10.6a1.5 1.5 0 0 0 1.5 1.4h4.4a1.5 1.5 0 0 0 1.5-1.4l.8-10.6M8.5 9v5M11.5 9v5" />
  {:else if name === 'bell'}
    <path d="M5.5 13.5V9a4.5 4.5 0 0 1 9 0v4.5l1.5 1.5H4z" />
    <path d="M8.3 17a1.8 1.8 0 0 0 3.4 0" />
  {:else if name === 'tag'}
    <path d="M3.5 10.2V4.5a1 1 0 0 1 1-1h5.7l6.3 6.3a1.2 1.2 0 0 1 0 1.7l-4.8 4.8a1.2 1.2 0 0 1-1.7 0z" />
    <circle cx="7" cy="7" r="1.2" fill={color} stroke="none" />
  {:else if name === 'calendar'}
    <rect x="3" y="4" width="14" height="13" rx="2.5" />
    <path d="M3 8h14M7 2.5v3M13 2.5v3M6.5 11h1M9.5 11h1M12.5 11h1M6.5 14h1M9.5 14h1" />
  {:else if name === 'arrow'}
    <path d="M3.5 10h12.5M11.5 5.5 16 10l-4.5 4.5" />
  {:else if name === 'sidebar'}
    <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" />
    <path d="M8 3.5v13" />
  {:else if name === 'cloud'}
    <path d="M6 15.5h8.5a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 5.3 9.6 3 3 0 0 0 6 15.5z" />
  {:else if name === 'rename'}
    <path d="M12.5 4.5l3 3L7.5 15.5H4.5v-3z" />
    <path d="M11 6l3 3" />
  {:else if name === 'move'}
    <path d="M10 2.5l6.5 3.5v8L10 17.5 3.5 14V6z" />
    <path d="M7 10h6M10.5 7.5 13 10l-2.5 2.5" />
  {:else if name === 'heading'}
    <path d="M4 5.5h12" stroke-width="2.4" />
    <path d="M4 10.5h8M4 14.5h8M15 11.5v5M12.5 14h5" />
  {:else if name === 'unheading'}
    <path d="M4 5.5h12" stroke-width="2.4" />
    <path d="M4 10.5h8M4 14.5h6M12.5 14h5" />
  {:else if name === 'complete'}
    <circle cx="10" cy="10" r="7" />
    <path d="M7 10.2l2.2 2.2L13.4 8" />
  {:else if name === 'chevron'}
    <path d="M8 5.5l4.5 4.5L8 14.5" />
  {:else if name === 'search'}
    <circle cx="9" cy="9" r="5" />
    <path d="M13 13l3.5 3.5" />
  {/if}
</svg>
