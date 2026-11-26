<script lang="ts">
  /**
   * Project-complete celebration (#156): confetti, a gold coin stamped with the OpenThings logo
   * that swoops in and spins, and the project's name. A few seconds long; a tap, click or any key
   * skips it. Art and motion are original to this project. With reduced motion there is no
   * confetti and the coin just fades in, face on.
   */
  import { onMount } from 'svelte';
  import { burst, step, type Piece } from '../confetti';

  let { name, onclose }: { name: string; onclose: () => void } = $props();

  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LENGTH = reduce ? 2400 : 3600;
  const FADE = 300;
  /** Layers stacked along the coin's axis: seen edge-on they make its thickness. */
  const EDGE = Array.from({ length: 13 }, (_, i) => i - 6);

  let canvas = $state<HTMLCanvasElement>();
  let leaving = $state(false);
  let opened = 0;

  function dismiss() {
    if (leaving) return;
    leaving = true;
    setTimeout(onclose, FADE);
  }

  /** Ignore the first moments, so the key or tap that completed the project can't skip it at once. */
  function skip() {
    if (performance.now() - opened > 250) dismiss();
  }

  function onkey(e: KeyboardEvent) {
    if (e.repeat || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    // Swallow it: the key ends the celebration and does nothing else.
    e.preventDefault();
    e.stopImmediatePropagation();
    skip();
  }

  onMount(() => {
    opened = performance.now();
    window.addEventListener('keydown', onkey, true);
    const timer = setTimeout(dismiss, LENGTH - FADE);
    let frame = 0;

    if (!reduce && canvas) {
      const cv = canvas;
      const g = cv.getContext('2d');
      const css = getComputedStyle(document.documentElement);
      const colors = ['--star', '--accent', '--logbook', '--deadline', '--habits', '--matrix', '--anytime']
        .map((v) => css.getPropertyValue(v).trim())
        .filter(Boolean);
      let w = 0;
      let h = 0;
      const size = () => {
        const dpr = window.devicePixelRatio || 1;
        w = window.innerWidth;
        h = window.innerHeight;
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
        g?.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      size();
      window.addEventListener('resize', size);

      // Enough speed from the bottom corners to reach near the top of the window.
      const speed = Math.sqrt(2 * 900 * h * 0.85) * 1.15;
      const count = w < 760 ? 70 : 120;
      let pieces: Piece[] = [
        ...burst(count, 0, h, -Math.PI / 3, 0.9, speed, colors),
        ...burst(count, w, h, (-2 * Math.PI) / 3, 0.9, speed, colors),
      ];
      const shower = setTimeout(() => (pieces = pieces.concat(burst(count, w / 2, -20, Math.PI / 2, Math.PI * 0.9, 380, colors))), 450);

      let last = performance.now();
      const tick = (now: number) => {
        // A frame's timestamp can predate the mount; never step backwards.
        const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
        last = Math.max(last, now);
        pieces = step(pieces, dt, h);
        if (g) {
          g.clearRect(0, 0, w, h);
          for (const p of pieces) {
            g.save();
            g.translate(p.x, p.y);
            g.rotate(p.rot);
            g.scale(Math.cos(p.flip), 1);
            g.fillStyle = p.color;
            if (p.round) {
              g.beginPath();
              g.arc(0, 0, p.h * 0.6, 0, Math.PI * 2);
              g.fill();
            } else g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            g.restore();
          }
        }
        if (pieces.length || now - opened < 600) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);

      return () => {
        cancelAnimationFrame(frame);
        clearTimeout(shower);
        clearTimeout(timer);
        window.removeEventListener('resize', size);
        window.removeEventListener('keydown', onkey, true);
      };
    }

    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onkey, true);
    };
  });
</script>

{#snippet face()}
  <!-- A gold face with a raised rim, stamped with the app logo (same mark as public/favicon.svg). -->
  <svg viewBox="0 0 100 100" width="100%" height="100%">
    <defs>
      <radialGradient id="cel-gold" cx="0.36" cy="0.3" r="0.8">
        <stop offset="0" style="stop-color: color-mix(in srgb, var(--star) 45%, white)" />
        <stop offset="0.55" style="stop-color: var(--star)" />
        <stop offset="1" style="stop-color: color-mix(in srgb, var(--star) 60%, var(--habits))" />
      </radialGradient>
      <linearGradient id="cel-logo" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#5b8ff9" />
        <stop offset="1" stop-color="#2f6fed" />
      </linearGradient>
    </defs>
    <circle cx="50" cy="50" r="49" fill="url(#cel-gold)" />
    <circle cx="50" cy="50" r="43.5" fill="none" class="rim-dark" stroke-width="3" />
    <circle cx="50" cy="50" r="40.5" fill="none" class="rim-light" stroke-width="1.5" />
    <rect x="27" y="27" width="46" height="46" rx="12" fill="url(#cel-logo)" class="logo-edge" stroke-width="2.5" />
    <rect x="27" y="27" width="46" height="23" rx="12" fill="#fff" opacity="0.08" />
    <g transform="translate(27 27) scale(0.4107) translate(-8 -8)">
      <path d="M40 66 L56 82 L90 46" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />
    </g>
    <ellipse cx="34" cy="24" rx="15" ry="6" transform="rotate(-35 34 24)" fill="#fff" opacity="0.35" />
  </svg>
{/snippet}

<!-- A full-screen layer: tap anywhere to skip. Keyboard users skip with any key (window listener). -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="celebration" class:reduce class:leaving onpointerdown={skip} role="presentation">
  {#if !reduce}<canvas bind:this={canvas} aria-hidden="true"></canvas>{/if}
  <div class="stage" role="status" aria-live="polite">
    <div class="coin-wrap" aria-hidden="true">
      <div class="rays">
        {#each Array(8) as _, i (i)}<span style:--i={i}></span>{/each}
      </div>
      <div class="coin-bob">
        <div class="coin">
          {#each EDGE as z (z)}<span class="edge" style:--z={z}></span>{/each}
          <div class="face front">{@render face()}</div>
          <div class="face back">{@render face()}</div>
        </div>
      </div>
      <div class="shadow"></div>
    </div>
    <p class="title">Project complete!</p>
    <p class="name">{name}</p>
    <p class="hint">Tap or press any key to continue</p>
  </div>
</div>

<style>
  .celebration {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
    animation: fade-in 0.25s var(--ease) both;
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }
  .celebration.leaving {
    animation: fade-out 0.3s ease forwards;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .stage {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0 16px;
    text-align: center;
    pointer-events: none;
  }

  .coin-wrap {
    position: relative;
    width: 132px;
    height: 150px;
    animation: swoop 0.75s cubic-bezier(0.25, 1.5, 0.5, 1) both;
  }
  .coin-bob {
    position: absolute;
    left: 0;
    top: 0;
    width: 132px;
    height: 132px;
    perspective: 700px;
    animation: bob 0.9s ease-in-out 1s infinite alternate;
  }
  /* One turn every 0.6 s once it settles; the spin-in ends at that same speed, so the hand-off is seamless. */
  .coin {
    position: relative;
    width: 100%;
    height: 100%;
    transform-style: preserve-3d;
    animation:
      spin-in 0.9s cubic-bezier(0.3, 0.5, 0.7, 0.85) both,
      spin 0.6s linear 0.9s infinite;
  }
  .edge,
  .face {
    position: absolute;
    inset: 0;
    border-radius: 50%;
  }
  .edge {
    transform: translateZ(calc(var(--z) * 1px));
    background: color-mix(in srgb, var(--star) 62%, var(--habits));
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--star) 45%, var(--habits));
  }
  .face {
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
  }
  .front {
    transform: translateZ(7px);
  }
  .back {
    transform: rotateY(180deg) translateZ(7px);
  }
  .face svg {
    display: block;
  }
  .rim-dark {
    stroke: color-mix(in srgb, var(--star) 55%, var(--habits));
  }
  .rim-light {
    stroke: color-mix(in srgb, var(--star) 40%, white);
  }
  .logo-edge {
    stroke: color-mix(in srgb, var(--star) 30%, white);
  }
  /* A soft shadow on the "ground" that shrinks as the coin bobs up. */
  .shadow {
    position: absolute;
    left: 50%;
    bottom: 0;
    width: 84px;
    height: 12px;
    margin-left: -42px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--text) 18%, transparent);
    animation: shadow 0.9s ease-in-out 1s infinite alternate;
  }

  .rays {
    position: absolute;
    inset: 0;
  }
  .rays span {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 6px;
    height: 18px;
    margin: -9px 0 0 -3px;
    border-radius: 3px;
    background: var(--star);
    opacity: 0;
    transform: rotate(calc(var(--i) * 45deg)) translateY(0);
    animation: ray 0.7s var(--ease) 0.55s both;
  }

  .title {
    margin: 18px 0 0;
    font-family: 'Caveat', 'Bradley Hand', cursive;
    font-weight: 600;
    font-size: 44px;
    line-height: 1.1;
    color: var(--text);
    animation: pop 0.45s cubic-bezier(0.25, 1.6, 0.5, 1) 0.45s both;
  }
  .name {
    margin: 4px 0 0;
    max-width: min(520px, 100%);
    font-size: 17px;
    font-weight: 600;
    color: var(--text);
    overflow-wrap: anywhere;
    animation: rise 0.4s var(--ease) 0.7s both;
  }
  .hint {
    margin: 22px 0 0;
    font-size: 12px;
    color: var(--text-2);
    animation: rise 0.4s var(--ease) 1.2s both;
  }

  /* Reduced motion: no flight, no spin, no rays; everything simply fades in. */
  .reduce .coin-wrap,
  .reduce .coin-bob,
  .reduce .coin,
  .reduce .shadow,
  .reduce .title,
  .reduce .name,
  .reduce .hint {
    animation: fade-in 0.3s ease both;
  }
  .reduce .rays {
    display: none;
  }

  @keyframes fade-in {
    from { opacity: 0; }
  }
  @keyframes fade-out {
    to { opacity: 0; }
  }
  @keyframes swoop {
    from { opacity: 0; transform: translateY(45vh) scale(0.3); }
    40% { opacity: 1; }
  }
  @keyframes spin-in {
    from { transform: rotateY(0deg) scale(0.7); }
    to { transform: rotateY(1080deg) scale(1); }
  }
  @keyframes spin {
    from { transform: rotateY(0deg); }
    to { transform: rotateY(360deg); }
  }
  @keyframes bob {
    from { transform: translateY(0); }
    to { transform: translateY(-10px); }
  }
  @keyframes shadow {
    from { transform: scaleX(1); opacity: 1; }
    to { transform: scaleX(0.8); opacity: 0.6; }
  }
  @keyframes ray {
    0% { opacity: 0; transform: rotate(calc(var(--i) * 45deg)) translateY(-40px) scaleY(0.4); }
    30% { opacity: 1; }
    100% { opacity: 0; transform: rotate(calc(var(--i) * 45deg)) translateY(-104px) scaleY(1); }
  }
  @keyframes pop {
    from { opacity: 0; transform: scale(0.5); }
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(8px); }
  }
</style>
