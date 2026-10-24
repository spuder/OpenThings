# iOS app

Status: **builds in CI (Simulator, unsigned); not yet tested on a device.** The app is the same web code wrapped with [Capacitor](https://capacitorjs.com) 8, plus small Swift extensions for the parts web code can't do.

| Piece | Where | State |
| --- | --- | --- |
| App shell (WKWebView, `capacitor://localhost`) | `ios/App/App`, `capacitor.config.ts` | Implemented |
| Reminder notifications scheduled with iOS | `src/lib/native/capacitor.svelte.ts` | Implemented |
| Tap a notification → open the task | same | Implemented |
| Widgets: Today (Home + Lock Screen), Sync status, voice/Inbox/Brain Dump quick add | `ios/App/OpenThingsWidgets` | Implemented (quick-add actions require iOS 17+) |
| Share Sheet → Inbox or Brain Dump | `ios/App/OpenThingsShare` | Implemented |
| Shortcuts / Siri: Add To-Do (quick-add syntax), Open Today | `ios/App/App/OpenThingsIntents.swift` | Implemented |
| Interactive widgets (check off from the Home Screen) | — | Not started (needs a write path from the widget; see "Next") |

Everything iOS-specific is in `ios/` and `src/lib/native/`. The web, PWA and Docker builds don't load any of it (`Capacitor.isNativePlatform()` is false in a browser and the native module is a lazy import).

## Siri and Shortcuts

The app gives iOS two actions (App Intents, `ios/App/App/OpenThingsIntents.swift`). They show up in Siri, the Shortcuts app and Spotlight on their own once the app is installed and opened once; there's nothing to set up.

| Say to Siri | What happens |
| --- | --- |
| "Add to OpenThings" or "Add a to-do in OpenThings" | Siri asks *What do you want to add?* and adds what you say as the title. Quick-add syntax (`@fri`, `%9am`, `#phone`) needs typing, so use it in the **Add To-Do** action in the Shortcuts app. |
| "Show my day in OpenThings" or "Open Today in OpenThings" | Opens the app on Today. |

- **Where it goes:** the Inbox, unless the text places it (`@today`, `+Project`). In the Shortcuts app, **Add To-Do** also has a **Brain Dump** switch.
- **When it appears:** Siri doesn't open the app. The to-do is queued and added the next time you open OpenThings, then syncs as usual.
- **Your own shortcuts:** in the Shortcuts app, search for OpenThings to use **Add To-Do** and **Open Today** as steps, for example from a Back Tap, an automation or a Home Screen icon. The *Open URLs* action with an [`openthings://` link](url-scheme.md) can open any list, or add a to-do with a title, list, date and tags.
- **Needs** the App Group, so a paid Apple Developer account when you build the app yourself (see [Running on your iPhone](#running-on-your-iphone)).
- **Not yet:** Siri can't read your list aloud or complete a to-do, and the phrase can't include the to-do itself ("Add buy milk to OpenThings"): Apple only allows fixed phrases, so Siri always asks.

## Quick-add widgets

On iOS 17 and later, the OpenThings widget gallery includes three small action widgets:

- **Add by voice** asks what to add to the Inbox; dictate a response in the system's App Intent input prompt.
- **Add to Inbox** asks for a to-do and queues it for the Inbox.
- **Brain Dump** asks for a to-do and queues it for the Brain Dump.

The widgets write to the same App Group pending-item queue as Shortcuts. The app imports each item through the normal store and sync path the next time it is opened (or immediately if already running). The Brain Dump action follows the existing behavior when the Brain Dump feature is disabled: the item is added to the Inbox instead.

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
     Widgets (read/quick-add)       Share extension     App Intents (write) ─ Darwin notify
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

Extensions and widgets can't run the web code or touch IndexedDB, so they queue work as files and the app does the write through the normal store, which records it in the op log (and therefore syncs).

- Share, Shortcuts and quick-add widgets each write one file per item at `<App Group>/pending/<epoch-ms>-<uuid>.json` (so there is no cross-process read-modify-write):

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

Widgets, notifications, App Intents and the pairing QR code open `openthings://` links, and so can your own Shortcuts (*Open URLs*): `openthings://today`, `openthings://task/<id>`, `openthings://add?title=…&when=…&list=…&save=1`, `openthings://pair?server=<url>`, … All links and parameters: [url-scheme.md](url-scheme.md). The app handles them in `src/lib/native/links.ts`.

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

### Simulator test for quick-add widgets

Use an iOS 17 or later simulator and run the **App** scheme from Xcode. The app and widget extension need a working App Group entitlement for queued items to be shared. On the Home Screen, long-press, add each OpenThings quick-add widget, then invoke it:

1. **Add by voice:** dictate a title in the App Intent prompt (or enter one if simulator dictation is unavailable); verify it appears in the Inbox.
2. **Add to Inbox:** enter a different title; verify it appears in the Inbox.
3. **Brain Dump:** enter a third title; verify it appears in Brain Dump.
4. Repeat while the app is already open and verify the task imports without relaunching. If Brain Dump is disabled in Settings, verify its action falls back to Inbox.

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
- [ ] On iOS 17+, add each OpenThings quick-add widget (Add by voice, Add to Inbox, Brain Dump) to the Home Screen. Invoke each; dictate a title for Add by voice and enter titles for the other two. Open or foreground the app and confirm the tasks land in Inbox, Inbox, and Brain Dump respectively. Repeat with the app already open to verify queued tasks import immediately.
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
- Android: in preview from the same `src/lib/native` module, with the app's own files instead of the App Group; see [android.md](android.md).
- Optional: a background refresh task so widgets roll over to the new day without opening the app.
