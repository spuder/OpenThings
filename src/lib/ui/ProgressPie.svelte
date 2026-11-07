<script lang="ts">
  // idle: an idle project, drawn in grey with a dashed ring instead of the accent color.
  let { value, size = 16, idle = false }: { value: number; size?: number; idle?: boolean } = $props();
  const color = $derived(idle ? 'var(--idle)' : 'var(--accent)');
  const r = 5.2;
  const path = $derived.by(() => {
    if (value <= 0) return '';
    if (value >= 1) return `M8 8 m-${r} 0 a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 -${2 * r} 0`;
    const a = value * 2 * Math.PI - Math.PI / 2;
    const x = 8 + r * Math.cos(a);
    const y = 8 + r * Math.sin(a);
    const large = value > 0.5 ? 1 : 0;
    return `M8 8 L8 ${8 - r} A${r} ${r} 0 ${large} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`;
  });
</script>

<svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
  <circle cx="8" cy="8" r="6.6" fill="none" stroke={color} stroke-width="1.5" stroke-dasharray={idle ? '2.2 1.6' : undefined} />
  {#if path}<path d={path} fill={color} />{/if}
</svg>
