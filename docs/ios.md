# iOS app

Status: **builds in CI (Simulator, unsigned); not yet tested on a device.** The app is the same web code wrapped with [Capacitor](https://capacitorjs.com) 8, plus small Swift extensions for the parts web code can't do.

| Piece | Where | State |
| --- | --- | --- |
| App shell (WKWebView, `capacitor://localhost`) | `ios/App/App`, `capacitor.config.ts` | Implemented |
| Reminder notifications scheduled with iOS | `src/lib/native/capacitor.svelte.ts` | Implemented |
| Tap a notification → open the task | same | Implemented |
| Widgets: Today (Home + Lock Screen), Sync status | `ios/App/OpenThingsWidgets` | Implemented |
| Share Sheet → Inbox or Brain Dump | `ios/App/OpenThingsShare` | Implemented |
| Shortcuts / Siri: Add To-Do (quick-add syntax), Open Today | `ios/App/App/OpenThingsIntents.swift` | Implemented |
| Interactive widgets (check off from the Home Screen) | — | Not started (needs a write path from the widget; see "Next") |

Everything iOS-specific is in `ios/` and `src/lib/native/`. The web, PWA and Docker builds don't load any of it (`Capacitor.isNativePlatform()` is false in a browser and the native module is a lazy import).

## Architecture

```
┌──────────────────── App (WKWebView, capacitor://localhost) ─────────────────────┐
│  Svelte app, SQLite (sql.js) in IndexedDB, op log, sync engine — unchanged     │
│                                                                                 │
│  window.OpenThings bridge ── src/lib/native/capacitor.svelte.ts (native only)   │
│     reminders.upcoming() ───► @capacitor/local-notifications (schedule/cancel)  │
│     openthings:reminders ───► reschedule                                        │
│     openthings:sync + store ► OpenThingsNative.writeSnapshot ─┐                 │
│     store.addParsed ◄──────── OpenThingsNative.takePending ◄──┼──┐              │
└───────────────────────────────────────────────────────────────┼──┼──────────────┘
                                         App Group container    ▼  │
                       snapshot.json   pending/*.json   route.txt  │
                            │                ▲              ▲      │
                  ┌─────────┘                │              │      │
           Widgets (read)          Share extension     App Intents (write) ─ Darwin notify
```

### Origin and storage

`capacitor.config.ts` fixes `ios.scheme = 'capacitor'` and `server.hostname = 'localhost'`, so the page origin is always `capacitor://localhost`. IndexedDB is per origin; changing either value would start with an empty database. Data stays on the device (the WebView's website data store) until the sync server is configured.

When the sync server exists, the app calls it cross-origin from `capacitor://localhost`, so the server must allow that origin (CORS) and be reached over HTTPS (iOS App Transport Security blocks plain HTTP; Tailscale's `*.ts.net` certificates work). "Use this site" is hidden in Settings on native builds because the page's own origin is not a server.

### Reminders → local notifications

On the web, reminders only fire while the app is open. On iOS:

1. On start and on every `openthings:reminders` event (fired by the store whenever the set of pending reminders changes), the app cancels every notification it scheduled (`extra.kind === 'reminder'`) and schedules `reminders.upcoming()` again, soonest first, at most 60 (iOS keeps 64 pending per app).
2. Notification ids are a stable 31-bit hash of the task id (`notificationId()` in `src/lib/native/snapshot.ts`), and `extra.taskId` carries the real id.
3. Tapping one fires `localNotificationActionPerformed` → `store.reveal(taskId)`: the same function the web service worker's `openthings:open-task` message uses. If the tap launched the app, `reveal` waits until the first view is shown (`store.start()`).
4. When the app is open as the reminder comes due, the store still marks it sent, plays the chime and shows the toast, but doesn't show a second notification (`notifier.osDelivers`).
5. Permission: Settings → Notifications → **Allow notifications** (or setting the first reminder) calls `LocalNotifications.requestPermissions()`. Settings shows how many reminders are scheduled with the system.

A `window.postMessage({ type: 'openthings:open-task', taskId })` also reveals a task, for native code that wants to.

### Snapshot (app → widgets)

Written to `<App Group>/snapshot.json` 400 ms after the task list, the day or the sync state changes (and when the app goes to the background), then `WidgetCenter.reloadAllTimelines()`. Unchanged content is not rewritten. Built by `buildSnapshot()` in `src/lib/native/snapshot.ts`; decoded by `OTSnapshot` in `ios/App/Shared/OTShared.swift`.

```json
{
  "version": 1,
  "generatedAt": "2026-10-18T15:04:05.000Z",
  "day": "2026-10-18",
  "today": [
    { "id": "0192…", "title": "Call dentist", "evening": false, "container": "Health", "deadline": null, "reminderAt": "2026-10-18T16:00:00.000Z" }
  ],
  "counts": { "today": 4, "evening": 1, "inbox": 2, "dump": 3 },
  "reminders": [{ "taskId": "0192…", "title": "Call dentist", "at": "2026-10-18T16:00:00.000Z" }],
  "sync": { "status": "idle", "enabled": true, "pending": 0, "lastSyncedAt": "2026-10-18T15:03:00.000Z", "error": null }
}
```

`today` holds up to 12 rows (Today, then This Evening); `counts` are the full numbers. Widgets refresh when the app writes, at midnight, and every 30 minutes. If `day` is before the current day the Today widget says "Open OpenThings to refresh" rather than showing yesterday's list.

### Pending to-dos (extensions → app)

Extensions can't run the web code or touch IndexedDB, so they queue work as files and the app does the write through the normal store, which records it in the op log (and therefore syncs).

- Each item is one file `<App Group>/pending/<epoch-ms>-<uuid>.json` (one file per item, so no cross-process read-modify-write):

  ```json
  { "id": "…", "text": "Call dentist @fri %9am", "notes": null, "parse": true, "target": "inbox", "source": "shortcut", "createdAt": "…" }
  ```

  - `parse: true` (Shortcuts): `text` goes through the quick-add parser.
  - `parse: false` (Share Sheet): the first line is the title, taken literally (shared pages often contain `#` or `@`); the URL and any further lines go into notes.
  - `target: "dump"` sends it to the Brain Dump unless the text itself places it (`@today`, `+Project`).
- `<App Group>/route.txt` holds one `openthings://…` link for the app to open (used by **Open Today**).
- After writing, the extension posts the Darwin notification `<App Group>.pending`.
- The app imports on launch, on every foreground (`resume` / `appStateChange`), and immediately on that Darwin notification if it's running: `OpenThingsNative.takePending()` returns and deletes the files, and each item goes through `pendingToParsed()` → `store.addParsed(p, { useContext: false })`. A toast says how many were added.

### URL scheme

`openthings://today`, `openthings://inbox`, `openthings://upcoming`, `openthings://dump`, `openthings://task/<id>`, `openthings://add?text=<quick-add text>` (opens quick add pre-filled), `openthings://pair?server=<url>` (opens Settings → Sync with the server filled in, see `docs/sync.md#pairing-a-phone`). Widgets use these; so can your own Shortcuts ("Open URL").

### Native plugin

`ios/App/App/OpenThingsPlugin.swift`, JS name `OpenThingsNative`, registered in `OpenThingsViewController.capacitorDidLoad()`:

| Method | Does |
| --- | --- |
| `writeSnapshot({ json })` | Writes `snapshot.json`, reloads widget timelines |
| `takePending()` | `{ items, route }`, deleting what it returns |
| `info()` | `{ appGroup, containerAvailable }` for Settings |
| `scanQRCode()` | Opens a full-screen camera (`QRScannerViewController.swift`) and resolves `{ value }` with the first QR code; rejects with code `CANCELLED` or `DENIED` (camera access off) |
| event `pendingChanged` | An extension queued something |

## Identifiers (change them in one place)

`ios/App/Config/OpenThings.xcconfig`:

| Setting | Default | Used for |
| --- | --- | --- |
| `OT_BUNDLE_ID` | `io.github.spuder.openthings` | App; extensions are `$(OT_BUNDLE_ID).widgets` and `.share` |
| `OT_APP_GROUP` | `group.$(OT_BUNDLE_ID)` | Entitlements and `OTAppGroup` in each Info.plist |
| `OT_URL_SCHEME` | `openthings` | Deep links |
| `DEVELOPMENT_TEAM` | empty | Your signing team |

Put personal overrides in `ios/App/Config/OpenThings.local.xcconfig` (git-ignored), e.g. `DEVELOPMENT_TEAM = ABCDE12345`. `appId` in `capacitor.config.ts` is only used by the Capacitor CLI; keep it in step if you change the bundle id.

## Running on your iPhone

Needs a Mac with Xcode 26 or newer (Capacitor 8 requirement), Node 22, and an Apple ID. A free Apple ID works for the app itself, but App Groups (widgets, share sheet, Shortcuts) need a paid Apple Developer Program membership.

1. `npm ci && npm run build && npx cap sync ios`
2. Create `ios/App/Config/OpenThings.local.xcconfig` with `DEVELOPMENT_TEAM = <your team id>`. If the bundle id `io.github.spuder.openthings` is taken in your account, also set `OT_BUNDLE_ID = <yours>`.
3. `npx cap open ios` (opens `ios/App/App.xcodeproj`). Swift packages resolve on first open.
4. For each target (**App**, **OpenThingsWidgets**, **OpenThingsShare**) → *Signing & Capabilities*: check "Automatically manage signing" and that the team is set. The App Groups capability is already in the entitlements file; Xcode registers the group (`group.<bundle id>`) the first time. If it shows a red error, click the group's refresh button or add it at developer.apple.com → Identifiers → App Groups and enable it on all three identifiers.
5. Plug in the iPhone, enable Developer Mode on it (Settings → Privacy & Security), choose it as the run destination, scheme **App**, press Run.
6. On first launch: Settings in the app → Notifications → Allow notifications.

After changing web code: `npm run build && npx cap sync ios`, then Run again. For live reload during development you can temporarily set `server.url` to your Vite dev server in `capacitor.config.ts` (don't commit it: it changes the origin, so the dev database is separate).

CI (`.github/workflows/ios.yml`) builds the App scheme (which builds and embeds both extensions) for the Simulator with `CODE_SIGNING_ALLOWED=NO`.

## Device test checklist

- [ ] App launches to an empty database (no demo data), no white flash in dark mode.
- [ ] Force-quit and relaunch: data is still there (IndexedDB persisted).
- [ ] Settings → Notifications → Allow; iOS prompt appears; status shows "Allowed".
- [ ] "Test in 10 seconds", then lock the phone: banner arrives.
- [ ] Add `Test reminder %in2m`, force-quit the app: the notification arrives on time with the app closed.
- [ ] Tap that notification: the app opens on the right list with the to-do open.
- [ ] Change the reminder time, then delete the to-do: Settings' "Scheduled with the system" count follows; no stale notification arrives.
- [ ] Complete a to-do with a reminder before it fires: no notification.
- [ ] Add the **Today** widget (small, medium, large) and a Lock Screen widget: it shows Today; completing a to-do in the app updates it within a few seconds.
- [ ] Tap a row in the medium widget: opens that to-do. Tap the small widget: opens Today.
- [ ] Add the **Sync status** widget: shows "Local only" (or the real status with a server).
- [ ] Next morning without opening the app: the Today widget asks you to open the app instead of showing yesterday.
- [ ] Safari → Share → OpenThings: edit the title, pick Inbox, Add. Open the app: it's in the Inbox with the URL in notes and a toast "Added 1 shared to-do".
- [ ] Same with Brain Dump; and share while the app is already open in Slide Over / split view (imports right away).
- [ ] Shortcuts app → OpenThings → **Add To-Do** with `Buy milk @tomorrow #shop`: next time the app opens it's in Upcoming tomorrow with the tag.
- [ ] "Hey Siri, add a to-do in OpenThings".
- [ ] Shortcuts → **Open Today**: the app opens on Today.
- [ ] Settings → Sync → **Scan QR code**: iOS asks for camera access; scanning the code from desktop or web (Settings → Sync → Show QR code) fills in the server URL and the connection test passes. Cancel closes the camera without changes.
- [ ] Scan that QR code with the Camera app instead: OpenThings opens on Settings with the server filled in.
- [ ] Rotate / iPad: layout holds; safe areas respected (notch, home indicator).
- [ ] External keyboard on iPad: shortcuts (`Q`, `J`/`K`, `X`) work.

## Next

- Interactive widgets (iOS 17 `Button(intent:)`): complete a to-do from the Home Screen by queueing a `complete` item and importing it like the others.
- Android: `npx cap add android`; the same `src/lib/native` module works, with SharedPreferences + a Glance widget instead of the App Group.
- Optional: a background refresh task so widgets roll over to the new day without opening the app.
