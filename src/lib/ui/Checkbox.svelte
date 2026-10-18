<script lang="ts">
  let {
    checked,
    onToggle,
    small = false,
    urgent = false,
  }: { checked: boolean; onToggle: () => void; small?: boolean; urgent?: boolean } = $props();
</script>

<button
  class="box"
  class:checked
  class:small
  class:urgent
  role="checkbox"
  aria-checked={checked}
  aria-label={checked ? 'Mark incomplete' : 'Mark complete'}
  onclick={(e) => {
    e.stopPropagation();
    onToggle();
  }}
  ondblclick={(e) => e.stopPropagation()}
>
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4 8.4l2.6 2.6L12 5.4" />
  </svg>
</button>

<style>
  .box {
    flex-shrink: 0;
    width: 17px;
    height: 17px;
    margin-top: 2px;
    border-radius: 5px;
    border: 1.5px solid var(--line-strong);
    background: var(--bg);
    display: grid;
    place-items: center;
    transition:
      background 0.15s,
      border-color 0.15s,
      transform 0.15s var(--ease);
  }
  .box.urgent {
    border-color: var(--deadline);
  }
  .box:hover {
    border-color: var(--accent);
  }
  .box:active {
    transform: scale(0.88);
  }
  .box.small {
    width: 14px;
    height: 14px;
    border-radius: 4px;
    margin-top: 0;
  }
  svg {
    width: 100%;
    height: 100%;
    fill: none;
    stroke: white;
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 14;
    stroke-dashoffset: 14;
    transition: stroke-dashoffset 0.25s var(--ease) 0.05s;
  }
  .checked {
    background: var(--accent);
    border-color: var(--accent);
    animation: pop 0.32s var(--ease);
  }
  .checked svg {
    stroke-dashoffset: 0;
  }
  @keyframes pop {
    40% {
      transform: scale(1.22);
    }
  }
</style>
