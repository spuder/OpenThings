<script lang="ts">
  import { sync } from '../sync/engine.svelte';
  import { store } from '../store.svelte';

  let { compact = false }: { compact?: boolean } = $props();

  function ago(iso: string | null, now: number): string {
    if (!iso) return 'never';
    const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }

  const label = $derived.by(() => {
    switch (sync.status) {
      case 'local': return 'Local only';
      case 'idle': return `Synced ${ago(sync.lastSyncedAt, store.now)}`;
      case 'pending': return `${sync.pending} to sync`;
      case 'syncing': return 'Syncing…';
      case 'offline': return sync.pending ? `Offline · ${sync.pending} waiting` : 'Offline';
      case 'error': return 'Sync error';
    }
  });

  const detail = $derived.by(() => {
    switch (sync.status) {
      case 'local': return 'Sync is off. Data stays on this device. Click to set up sync.';
      case 'error': return `${sync.error ?? 'Sync failed'}. ${sync.pending} changes waiting. Click for settings.`;
      default: return `${sync.serverUrl ?? ''} · last sync ${ago(sync.lastSyncedAt, store.now)}`;
    }
  });
</script>

<button class="badge {sync.status}" class:compact onclick={() => store.go({ kind: 'settings' })} title={detail} aria-label={`Sync status: ${label}`}>
  <span class="dot" aria-hidden="true"></span>
  <span class="label">{label}</span>
</button>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-2);
    padding: 3px 9px;
    border-radius: 12px;
    white-space: nowrap;
    --c: var(--text-3);
  }
  .badge:hover {
    background: var(--chip);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c);
    flex-shrink: 0;
  }
  .idle {
    --c: var(--logbook);
  }
  .pending {
    --c: var(--star);
  }
  .syncing {
    --c: var(--accent);
  }
  .syncing .dot {
    animation: pulse 0.9s ease-in-out infinite;
  }
  .offline {
    --c: var(--text-3);
  }
  .error {
    --c: var(--deadline);
    color: var(--deadline);
    font-weight: 600;
  }
  .local .dot {
    background: transparent;
    border: 1.5px solid var(--text-3);
  }
  @keyframes pulse {
    50% {
      transform: scale(0.6);
      opacity: 0.5;
    }
  }
  @media (max-width: 760px) {
    .compact .label {
      max-width: 34vw;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
</style>
