<script lang="ts">
  let { value, size = 16 }: { value: number; size?: number } = $props();
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
  <circle cx="8" cy="8" r="6.6" fill="none" stroke="var(--accent)" stroke-width="1.5" />
  {#if path}<path d={path} fill="var(--accent)" />{/if}
</svg>
