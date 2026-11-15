<script lang="ts">
  // Animated backdrops written for OpenThings. Colors come from the --accent token so they follow the theme.
  import type { BackgroundStyle } from '../background.svelte';

  let { style }: { style: Exclude<BackgroundStyle, 'none'> } = $props();
  let canvas = $state<HTMLCanvasElement>();

  const FPS = 30;
  const MAX_DPR = 1.5;

  $effect(() => {
    if (style === 'aurora' || !canvas) return;
    const cv = canvas;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    let w = 0;
    let h = 0;
    let color = '#888';
    let raf = 0;
    let last = -Infinity;
    const pointer = { x: -1e4, y: -1e4 };
    let dots: { x: number; y: number; vx: number; vy: number; r: number }[] = [];

    const readColor = () => {
      color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || color;
    };
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, MAX_DPR);
      w = innerWidth;
      h = innerHeight;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(90, Math.round((w * h) / 18000));
      dots = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: 1.2 + Math.random() * 1.8,
      }));
    };

    function drawParticles(step: boolean) {
      ctx!.clearRect(0, 0, w, h);
      ctx!.fillStyle = color;
      ctx!.strokeStyle = color;
      for (const d of dots) {
        if (step) {
          // Dots drift and are gently pushed away from the cursor / finger.
          const dx = d.x - pointer.x;
          const dy = d.y - pointer.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 140 && dist > 0) {
            d.vx += (dx / dist) * 0.03;
            d.vy += (dy / dist) * 0.03;
          }
          d.vx *= 0.995;
          d.vy *= 0.995;
          d.x = (d.x + d.vx + w) % w;
          d.y = (d.y + d.vy + h) % h;
        }
        ctx!.globalAlpha = 0.35;
        ctx!.beginPath();
        ctx!.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.lineWidth = 1;
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const dist = Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y);
          if (dist > 120) continue;
          ctx!.globalAlpha = 0.18 * (1 - dist / 120);
          ctx!.beginPath();
          ctx!.moveTo(dots[i].x, dots[i].y);
          ctx!.lineTo(dots[j].x, dots[j].y);
          ctx!.stroke();
        }
      }
      ctx!.globalAlpha = 1;
    }

    function drawWaves(t: number) {
      ctx!.clearRect(0, 0, w, h);
      ctx!.fillStyle = color;
      const time = reduce.matches ? 0 : t / 1000;
      for (let layer = 0; layer < 4; layer++) {
        const base = h * (0.62 + layer * 0.1);
        const amp = 18 + layer * 8;
        const len = 380 + layer * 140;
        ctx!.globalAlpha = 0.05 + layer * 0.025;
        ctx!.beginPath();
        ctx!.moveTo(0, h);
        for (let x = 0; x <= w; x += 12) {
          const y = base + Math.sin(x / len + time * (0.35 + layer * 0.12) + layer) * amp + Math.sin(x / (len * 0.43) - time * 0.28) * amp * 0.35;
          ctx!.lineTo(x, y);
        }
        ctx!.lineTo(w, h);
        ctx!.closePath();
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
    }

    const draw = (t: number) => (style === 'particles' ? drawParticles(!reduce.matches) : drawWaves(t));
    const loop = (t: number) => {
      raf = 0;
      if (t - last >= 1000 / FPS - 2) {
        last = t;
        draw(t);
      }
      if (!reduce.matches && !document.hidden) raf = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    const redraw = () => {
      readColor();
      draw(performance.now());
    };
    const onResize = () => {
      resize();
      draw(performance.now());
    };
    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    };
    const onLeave = () => {
      pointer.x = pointer.y = -1e4;
    };

    readColor();
    resize();
    start();
    addEventListener('resize', onResize);
    addEventListener('pointermove', onMove, { passive: true });
    addEventListener('pointerup', onLeave);
    document.addEventListener('visibilitychange', start);
    reduce.addEventListener('change', start);
    const mo = new MutationObserver(redraw);
    mo.observe(document.documentElement, { attributes: true });
    const dark = matchMedia('(prefers-color-scheme: dark)');
    dark.addEventListener('change', redraw);

    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('resize', onResize);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onLeave);
      document.removeEventListener('visibilitychange', start);
      reduce.removeEventListener('change', start);
      dark.removeEventListener('change', redraw);
      mo.disconnect();
    };
  });
</script>

{#if style === 'aurora'}
  <div class="aurora" aria-hidden="true"><i></i><i></i><i></i></div>
{:else}
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
{/if}

<style>
  canvas,
  .aurora {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
  }
  .aurora {
    overflow: hidden;
  }
  .aurora i {
    position: absolute;
    width: 55vmax;
    height: 55vmax;
    border-radius: 50%;
    background: radial-gradient(circle, var(--accent) 0%, transparent 65%);
    opacity: 0.16;
    filter: blur(40px);
    will-change: transform;
    animation: drift 26s ease-in-out infinite alternate;
  }
  .aurora i:nth-child(1) {
    top: -20vmax;
    left: -10vmax;
  }
  .aurora i:nth-child(2) {
    bottom: -25vmax;
    right: -15vmax;
    background: radial-gradient(circle, var(--evening, var(--accent)) 0%, transparent 65%);
    animation-duration: 34s;
    animation-delay: -9s;
  }
  .aurora i:nth-child(3) {
    top: 30%;
    left: 40%;
    background: radial-gradient(circle, var(--habits, var(--accent)) 0%, transparent 65%);
    opacity: 0.1;
    animation-duration: 42s;
    animation-delay: -18s;
  }
  @keyframes drift {
    to {
      transform: translate3d(18vmax, 12vmax, 0) scale(1.2);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .aurora i {
      animation: none;
    }
  }
</style>
