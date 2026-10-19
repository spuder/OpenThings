# Sync (protocol v0, draft)

Status: the **client is implemented** (`src/lib/sync/`); the **server is not built yet**. Turning sync on today shows "Can't reach the server" and local changes keep waiting in the op log.

## Model

- Every local write is recorded in the `ops` table: `hlc`, `device`, `tbl`, `row_id`, `kind` (`insert` / `update` / `delete`), `payload`.
- `update` ops carry one field each, so conflicts resolve **per field, last writer wins** by hybrid logical clock (HLC). HLCs are `"<ms, 15 digits>:<counter, 5 digits>:<device>"` and compare as strings.
- A `delete` wins over a later-arriving `insert` of the same row.
- Remote ops are stored with `remote = 1` and never pushed back.
- Only the tables in `SYNC_TABLES` sync. `ops` and `meta` never leave the device. Table and column names in remote ops are checked against the local schema; unknown ones are skipped.

## Endpoints

```
GET  /api/health
  -> { "ok": true, "server": "openthings", "protocol": 0, "version": "x.y.z" }

POST /api/sync
  <- { "protocol": 0, "device": "a1b2c3d4e5f6", "cursor": "<opaque>" | null, "ops": [Op, …] }
  -> { "accepted": 12, "ops": [Op, …], "cursor": "<opaque>", "more": false }
```

- The server stores pushed ops (dedupe on `hlc + device`), then returns ops from **other** devices after `cursor`, oldest first, in batches. `more: true` means call again.
- `cursor` is opaque to clients (a server sequence number is fine).
- Auth: none in v0. The server is only reachable on the tailnet (DockTail). Device tokens are planned before anything is exposed more widely.
- The web app may be served by the same container, so the default server URL can be the page's own origin ("Use this site" in Settings).

## Client behavior

- Triggers: 1.5 s after a local write, every 30 s, when the browser comes back online, when the tab becomes visible, and "Sync now".
- Status, shown in the header on every screen and in Settings:

| Status | Meaning |
| --- | --- |
| `local` | Sync off; data stays on this device |
| `idle` | Up to date ("Synced 2m ago") |
| `pending` | Local changes waiting |
| `syncing` | Request in flight |
| `offline` | Device reports no network |
| `error` | Server unreachable or rejected the request (reason shown) |

Changing the server URL resets the cursor and re-pushes all local ops to the new server.

## Native shells (Tauri desktop, Capacitor mobile)

They load this same web app, so they read sync state from the bridge instead of re-implementing it:

```js
window.OpenThings.sync.getState();            // SyncState
const off = window.OpenThings.sync.subscribe((s) => { … });
await window.OpenThings.sync.syncNow();
window.addEventListener('openthings:sync', (e) => e.detail);  // SyncState on every change
```

Planned uses:

- **Tauri:** tray / menu-bar icon reflects status; tray menu has "Sync now".
- **Capacitor (iOS, implemented):** on each event the app writes a snapshot to the shared App Group so widgets show "Synced 2m ago" or "Offline"; see [ios.md](ios.md). Android (SharedPreferences) is planned.

Types: `src/lib/sync/protocol.ts` (`SyncState`, `SyncStatus`, request/response shapes).
