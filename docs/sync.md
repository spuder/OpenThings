# Sync (protocol v0, draft)

Status: **implemented.** Client in `src/lib/sync/`, server in `server/` (Bun + SQLite), shipped in the Docker image. Schema and op format are shared in `src/lib/schema.ts`.

## Model

- Every local write is recorded in the `ops` table: `hlc`, `device`, `tbl`, `row_id`, `kind` (`insert` / `update` / `delete`), `payload`.
- `update` ops carry one field each, so conflicts resolve **per field, last writer wins** by hybrid logical clock (HLC). HLCs are `"<ms, 15 digits>:<counter, 5 digits>:<device>"` and compare as strings.
- A `delete` wins over a later-arriving `insert` of the same row.
- Remote ops are stored with `remote = 1` and never pushed back.
- Only the tables in `SYNC_TABLES` sync. `ops` and `meta` never leave the device. Table and column names in remote ops are checked against the local schema; unknown ones are skipped.
- Remote ops apply one at a time. One that can't apply (a constraint, a missing required column) is skipped and still recorded, so it never blocks later syncs.
- Tags with the same name (ignoring case), created on two devices before they synced, are both kept; readers merge them (`mergeTags`), and the smallest id wins everywhere.

## Endpoints

```
GET  /api/health
  -> { "ok": true, "server": "openthings", "protocol": 0, "version": "x.y.z", "auth": false }

POST /api/sync
  <- { "protocol": 0, "device": "a1b2c3d4e5f6", "cursor": "<opaque>" | null, "ops": [Op, …] }
  -> { "accepted": 12, "ops": [Op, …], "cursor": "<opaque>", "more": false }
```

- The server stores pushed ops (dedupe on `hlc + device`), then returns ops from **other** devices after `cursor`, oldest first, in batches of 1000. `more: true` means call again.
- `cursor` is opaque to clients. The server uses `<database id>.<sequence>`; a cursor from another (or a reset) server database starts over from the beginning.
- Malformed ops (bad HLC, table or column names that aren't identifiers, non-scalar values) are ignored; the rest of the request still applies. A different `protocol` is rejected with 400.
- The web app is served by the same container, so the default server URL can be the page's own origin ("Use this site" in Settings).

## Auth and access

All optional; with none set, anyone who can reach the server can sync, which is fine on a tailnet.

- **Token** (`OPENTHINGS_TOKEN`): every request to `/api/sync`, `/api/v1/…` and `/mcp` must send `Authorization: Bearer <token>`, or it gets 401 with `WWW-Authenticate: Bearer`. Several comma-separated tokens are all accepted (one per device, or old and new while rotating). `/api/health` stays open and reports `"auth": true`, so a client can tell it needs one. Tokens are compared as SHA-256 hashes in constant time. CORS preflights (`OPTIONS`) don't need the token, since browsers never send it there.
- **Client:** the token is entered in Settings → Sync and stored in the device's local `meta` table (`sync.token`), which never syncs. The engine sends it on every sync. "Test connection" checks it with an authenticated `GET /api/v1`, which changes nothing.
- **Hosts** (`OPENTHINGS_HOSTNAMES`): requests whose `Host` (or `X-Forwarded-Host`, behind a proxy) isn't listed, or loopback, get 421. This blocks DNS rebinding: a page on `evil.example` that re-points its own name at your server is same-origin with itself, so the Origin check alone would let it through when port 8080 is reachable on your LAN.
- **Browsers:** requests with an `Origin` other than the server's own, the native shells (`capacitor://localhost`, Tauri) and `localhost` are refused with 403 unless listed in `OPENTHINGS_ALLOWED_ORIGINS`.

## Server

`server/` is one Bun process (`server/index.ts`) with the web app, sync, the [REST API and MCP](api.md):

- `server/db.ts`: every op from every device in `ops`, plus the current state materialized in the same tables as the app, with the same rules (per-field last writer wins by HLC, delete wins, updates that arrive before their insert still apply).
- REST and MCP writes go through `ServerDb.insert / update / remove`, which record ops under the server's own device id (`srv…`). Devices pull them like any other device's changes.
- `server/service.ts`: to-do actions, mirroring the app's store and reusing `parse.ts`, `views.ts` and `dates.ts`.
- Tests: `npm run test:server` (Bun).

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
