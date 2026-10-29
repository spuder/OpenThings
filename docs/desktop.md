# Desktop app (Tauri)

Status: **macOS and Arch Linux (Omarchy / Hyprland)**. macOS releases are signed with a Developer ID and notarized ([below](#signing-and-notarization)); pull request builds are ad-hoc signed. Ubuntu/Fedora packaging is on the backlog.

The desktop app is the same web app in a native window, plus what a browser can't do. Data stays local: SQLite in IndexedDB inside the app's webview (fixed origin `tauri://localhost`; on Linux the data lives in `~/.local/share/io.github.spuder.openthings/`), so it persists across launches and updates. It is separate from any browser's copy; use Export JSON in the browser and the sync server (when it ships) to move data.

## Features

| Feature | macOS | Arch / Hyprland |
| --- | --- | --- |
| Global quick-add hotkey, configurable in Settings → Desktop (default ⌃Space / Ctrl+Alt+Space / Super+Alt+Space on Hyprland) | yes | Hyprland: written into its config (below). X11: key grab. Other Wayland: bind `openthings --quick-add` yourself |
| Floating quick-add window (frameless, always on top, title `OpenThings Quick Add`) | yes | yes |
| `openthings://add?text=…` deep links, `openthings --quick-add [text]`, `openthings --add <text>` | links | yes |
| Tray / menu-bar icon showing sync status; menu: Show, Quick Add, Sync Now, Quit | menu bar | needs a StatusNotifier host (Waybar `tray` module) |
| Keeps running when the window is closed (reminders and sync continue) | yes | yes |
| Native reminder notifications; clicking one opens the task | Notification Center | libnotify / D-Bus: mako, dunst, swaync |
| Native menu bar (App, File, Edit, View, Window, Help) wired to the command registry | yes | — (keys go straight to the web app) |
| Window size and position remembered; single instance; launch at login | yes | yes |

## Architecture

```
src-tauri/src/lib.rs        Rust shell: windows, tray, menu, hotkey, deep links, CLI, notifications, reminder backstop
src-tauri/tauri.conf.json   App id io.github.spuder.openthings, bundles, deep-link scheme
src/lib/native/desktop.ts   JS side of the bridge (no-op outside Tauri; Tauri API loaded lazily)
src/lib/native/setup.ts     Connects the main window's store, commands and sync engine to the shell
src/lib/native/QuickAddWindow.svelte   UI of the floating quick-add window (reuses ui/QuickAdd.svelte)
src/lib/native/DesktopSettings.svelte  Settings → Desktop (only rendered in Tauri)
```

- **One database.** Only the main window opens SQLite. The quick-add window parses for the live preview but sends the raw text to the shell (`submit_quick_add`), which emits `ot://add` to the main window; that parses it with the same `parseQuickAdd` and adds it with `store.addParsed`, so it lands in the op log. Text without a list goes to the Inbox.
- **Commands.** Menu items, the tray and deep links emit `ot://command <id>` with an id from `src/lib/commands.ts`; the main window runs that command. Single-key shortcuts stay in the web app; the menu only binds chords (⌘N, ⌘,, ⌘K, ⌘F, ⌥1…⌥0, ⌘/, ⌘⇧E) and shows the others in its titles.
- **Reminders.** The main webview keeps running when hidden (`backgroundThrottling: disabled`; close hides the window). The existing scheduler in `store.svelte.ts` fires due reminders; in Tauri `notifier.native` routes them to the `show_notification` command instead of the web Notification API (no service worker). The web app also pushes `window.OpenThings.reminders.upcoming()` to the shell on every `openthings:reminders` event, and a Rust thread wakes at each reminder time as a backstop in case the webview's timers are throttled anyway. Both paths dedupe by task id. Notification clicks (`tap`) emit `ot://reveal <taskId>` → `store.reveal`.
- **Sync status.** `window.OpenThings.sync.subscribe` → `set_sync_status` → tray icon (5 states: local, synced, pending, offline, error) and the disabled status line in the tray menu. "Sync Now" emits `ot://sync-now` → `sync.kick()`.
- **Quitting.** Quit (menu, ⌘Q, tray) asks the web app to flush the database (`ot://will-quit` → `db.saveNow()` → `quit_now`), with a 1.5 s fallback.
- **Settings.** The hotkey is stored by the shell in `<config dir>/io.github.spuder.openthings/desktop.json`, not in the synced database, since it is per machine.
- **Hotkey on Hyprland.** `src-tauri/src/hyprland.rs`: when `HYPRLAND_INSTANCE_SIGNATURE` is set, `set_hotkey` doesn't grab a key; it writes the bind and the quick-add window rules to `~/.config/hypr/openthings.conf` and appends one `source = …` line to `hyprland.conf` (only then, from Settings, never on startup). Hyprland reloads changed config on its own (`hyprctl reload` if `misc:disable_autoreload` is set). It refuses keys `hyprctl binds` already shows bound to something else, and picks `windowrule { }` or `windowrulev2` from `hyprctl version`.
- **Guarding.** `isDesktop` (`'__TAURI_INTERNALS__' in window`) gates every native path; the web, PWA and Docker builds behave as before. Shared web files touched: `main.ts` (pick window), `reminders.svelte.ts` (`notifier.native` hook), `QuickAdd.svelte` (optional `native` prop), `SettingsView.svelte` (Desktop section).

Shell → web events: `ot://command`, `ot://add`, `ot://reveal`, `ot://open-url`, `ot://sync-now`, `ot://will-quit`, `ot://quick-add-open` (quick-add window). Web → shell commands: `desktop_info`, `set_hotkey`, `set_autostart`, `set_sync_status`, `set_reminders`, `show_notification`, `submit_quick_add`, `hide_quick_add`, `show_main_window`, `quit_now`.

## CLI and deep links

```sh
openthings                                   # show the window (or start)
openthings --quick-add                       # floating quick-add window
openthings --quick-add "Call dentist @fri"   # …prefilled
openthings --add "Buy milk #errand %5pm"     # add directly, no window
openthings --hidden                          # start in the tray (used by launch at login)
xdg-open 'openthings://add?text=Buy%20milk'           # quick-add window, prefilled
xdg-open 'openthings://add?title=Buy%20milk&save=1'   # add directly
xdg-open 'openthings://today'                         # open a list
xdg-open 'openthings://task/<task id>'                # open a task
```

All links and their parameters (title, notes, when, deadline, tags, list): [url-scheme.md](url-scheme.md). The Rust shell only routes them: `add` links open the quick-add window (or, with `save=1`, go to the main window, which adds them), everything else goes to the main window as `ot://open-url`, where the web app parses it.

A second launch hands its arguments to the running instance and exits.

## Hyprland (Omarchy)

Apps can't grab global keys on Wayland, so Hyprland has to bind quick add. Settings → Desktop does that for you: choose a shortcut (or **Use Super+Alt+Space**; Super+Space is Omarchy's launcher) and OpenThings writes `~/.config/hypr/openthings.conf` and sources it from `hyprland.conf`. The key works as soon as Hyprland reloads its config, which it does by itself. **Turn off** removes the bind; to remove it all, delete the `source` line and the file.

To set it up by hand instead (or in another compositor; sway uses `bindsym … exec openthings --quick-add`), put this in Omarchy's `~/.config/hypr/bindings.conf`:

```ini
bind = SUPER ALT, SPACE, exec, openthings --quick-add

# Hyprland 0.53+ window rule syntax
windowrule {
  name = openthings-quick-add
  match:title = ^(OpenThings Quick Add)$
  float = on
  center = on
  pin = on
}

# Older Hyprland (before 0.53):
# windowrulev2 = float, title:^(OpenThings Quick Add)$
# windowrulev2 = center, title:^(OpenThings Quick Add)$
# windowrulev2 = pin, title:^(OpenThings Quick Add)$
```

- **Tray:** the icon uses StatusNotifierItem (libayatana-appindicator). It appears only if something hosts a tray: Omarchy's Waybar has the `tray` module. Without one, OpenThings still runs hidden; `openthings` brings the window back.
- **Notifications:** sent over D-Bus (`org.freedesktop.Notifications`), so mako (Omarchy's default), dunst and swaync all work; no libnotify library needed. Clicking a notification invokes its default action, which opens the task. In mako that's a left click by default (`on-button-left=invoke-default-action`).
- **Launch at login** writes `~/.config/autostart/OpenThings.desktop`. Hyprland doesn't read XDG autostart unless something runs it (e.g. `dex -a`, or uwsm's autostart). The simpler alternative is `exec-once = openthings --hidden` in `~/.config/hypr/autostart.conf`.
- **Deep links** need the `.desktop` file from the package (`MimeType=x-scheme-handler/openthings`, `Exec=openthings %u`). An AppImage registers itself on first launch.

## Install

**macOS with Homebrew:** `brew tap spuder/openthings && brew trust spuder/openthings && brew install --cask openthings` (the [tap](https://github.com/spuder/homebrew-openthings) also links the `openthings` CLI).

**macOS by hand:** download the `.dmg` from [Releases](https://github.com/spuder/OpenThings/releases), or `OpenThings-macos-universal` from a [Desktop workflow run](https://github.com/spuder/OpenThings/actions/workflows/desktop.yml), unzip, open the `.dmg`, drag OpenThings to Applications. Releases and manual runs are notarized and open normally. Builds from pull requests are only ad-hoc signed, so their first open is blocked: on macOS 15+ try to open it, then System Settings → Privacy & Security → **Open Anyway**; on older macOS, right-click → Open. Alternatively: `xattr -dr com.apple.quarantine /Applications/OpenThings.app`.

**Arch:** run the AppImage from [Releases](https://github.com/spuder/OpenThings/releases), or install the package from a checkout (`makepkg` downloads the release tarball and checks it):

```sh
cd packaging/arch/openthings-bin
makepkg -si
```

To try a build from a [Desktop workflow run](https://github.com/spuder/OpenThings/actions/workflows/desktop.yml) instead, download `OpenThings-arch-x86_64`, copy its `openthings-<version>-linux-x86_64.tar.gz` into `packaging/arch/openthings-bin/` and run `makepkg -si --skipchecksums` (its checksum differs from the release's).

The `openthings` (source) and `openthings-bin` PKGBUILDs in `packaging/arch/` carry the checksums of the `v0.1.0` tag tarball and release asset. For a new release, bump `pkgver`, run `updpkgsums` and `makepkg --printsrcinfo > .SRCINFO`. CI checks that both build with `makepkg` in an `archlinux:latest` container (from this checkout's files, so with `--skipchecksums`) and that `.SRCINFO` matches.

## Releasing

Run `scripts/bump-version.sh X.Y.Z` (it updates `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` and the iOS `MARKETING_VERSION`), add a `CHANGELOG.md` entry, and open a `Release vX.Y.Z` PR. Merging it releases: the *Tag release* workflow sees the new version on `main`, checks the files agree, tags the commit `v<version>` and starts the Desktop and Container workflows on the tag. Don't push the tag yourself. (A matching tag pushed by hand still works; the workflow skips versions that are already tagged.) The Desktop workflow's `release` job refuses tags whose commit isn't on `main`, checks the tag matches the version, publishes a GitHub release with the `.dmg`, `.app.zip`, AppImage and Linux tarball, and pushes the new version and `.dmg` checksum to `Casks/openthings.rb` in [spuder/homebrew-openthings](https://github.com/spuder/homebrew-openthings). It pushes with a write deploy key on that repo, stored here as the `TAP_DEPLOY_KEY` secret; to rotate it, make a new key pair, replace the deploy key and the secret.

## Signing and notarization

The `macos` job signs and notarizes on `v*` tags and manual runs (Actions → Desktop → Run workflow) when these repository secrets exist. Pull requests and forks get ad-hoc signed builds, and the `release` job refuses to publish a tag whose macOS build wasn't notarized.

| Secret | What |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of a `.p12` export of a **Developer ID Application** certificate and its private key |
| `APPLE_CERTIFICATE_PASSWORD` | the password set when exporting the `.p12` |
| `APP_STORE_CONNECT_API_KEY_ID` | App Store Connect API key ID (Developer role or higher) |
| `APP_STORE_CONNECT_API_ISSUER_ID` | the key's issuer ID |
| `APP_STORE_CONNECT_API_KEY_CONTENT` | contents of the key's `AuthKey_<id>.p8` |

The API key secrets have the same names and values as in OpenSpool, so the same Apple Developer account and key can be reused. To set them up:

1. **Certificate** (once per account): in Xcode → Settings → Accounts → Manage Certificates → + → *Developer ID Application* (needs the Account Holder), or at [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates). In Keychain Access, under *My Certificates*, right-click *Developer ID Application: …* → Export → `.p12` with a password.
2. Store them:

   ```sh
   base64 -i DeveloperID.p12 | gh secret set APPLE_CERTIFICATE --repo spuder/OpenThings
   gh secret set APPLE_CERTIFICATE_PASSWORD --repo spuder/OpenThings
   gh secret set APP_STORE_CONNECT_API_KEY_ID --repo spuder/OpenThings
   gh secret set APP_STORE_CONNECT_API_ISSUER_ID --repo spuder/OpenThings
   gh secret set APP_STORE_CONNECT_API_KEY_CONTENT --repo spuder/OpenThings < AuthKey_XXXXXXXXXX.p8
   ```

   GitHub secrets can't be read back, so copy the API key values from where you saved them for OpenSpool (or make a new key in App Store Connect → Users and Access → Integrations).
3. Run the Desktop workflow by hand and check the *Notarize .dmg* step passes `spctl`.

How it works: the job imports the certificate into a temporary keychain and passes its identity to Tauri as `APPLE_SIGNING_IDENTITY` (overriding the ad-hoc `"-"` in `tauri.conf.json`). With `APPLE_API_KEY` / `APPLE_API_ISSUER` / `APPLE_API_KEY_PATH` set, Tauri signs the `.app` with the hardened runtime, notarizes it and staples the ticket. Tauri doesn't notarize the `.dmg`, so the job signs, notarizes (`notarytool`) and staples it too, then deletes the keychain and key.

## Building

Prerequisites: Rust (stable), Node 22. On Arch: `sudo pacman -S --needed base-devel rust nodejs npm webkit2gtk-4.1 gtk3 libayatana-appindicator librsvg xdotool openssl`. On macOS: Xcode command line tools.

```sh
npm ci
npm run tauri dev                       # live-reloading dev build (uses npm run dev)
npm run tauri build -- --bundles appimage   # Linux
npm run tauri build -- --target universal-apple-darwin --bundles app,dmg   # macOS
```

Tray icons are drawn by `scripts/make-tray-icons.py`; app icons are generated from the logo by `scripts/make-app-icons.sh` (full-bleed for Linux and Windows, padded to Apple's icon grid for macOS).

## Manual test checklist

macOS (not yet run on real hardware):

- [ ] First launch of a notarized release opens without a Gatekeeper prompt; window opens to an empty database (no demo data).
- [ ] Quit and relaunch: data, window size and position are kept.
- [ ] ⌃Space from another app opens the floating quick-add window; typing `Test @tomorrow %9am #x` previews tokens; ↵ adds it and the window hides; the to-do is in Upcoming with the tag and reminder. ⇧↵ adds and keeps the window open. Esc or clicking elsewhere hides it. Pressing ⌃Space again hides it. If ⌃Space switches input source instead (several keyboard layouts), turn off System Settings → Keyboard → Keyboard Shortcuts → Input Sources, or pick another key.
- [ ] Opening quick add repeatedly (with and without typing first): the text field appears in place, empty, without sliding or jumping.
- [ ] Settings → Desktop: click the shortcut and press the current one (⌃Space): it records instead of opening quick add; Esc cancels and ⌃Space works again.
- [ ] Settings → Desktop: record a new shortcut (e.g. ⌃⌥⌘T); the old one stops working, the new one works after relaunch. "Reset" and "Turn off" work. A shortcut taken by another app shows an error.
- [ ] Menu bar: File → New To-Do (⌘N), New Project, New Area; View → Today (⌥2) etc.; ⌘, opens Settings; ⌘K palette; ⌘F Quick Find; Help → Keyboard Shortcuts. No command fires twice (e.g. ⌘/ toggles the sidebar exactly once).
- [ ] ⌘C / ⌘V / ⌘X / ⌘A / ⌘Z work in the quick-add field and task notes.
- [ ] ⌘W hides the window; the app stays in the menu bar; clicking the Dock icon brings it back.
- [ ] Menu-bar icon: menu shows "Sync: Local only"; Show / Quick Add / Sync Now / Quit work. Turning on sync with an unreachable server turns the icon red ("error").
- [ ] Set a reminder 2 minutes ahead (`%in2m`), close the window (⌘W): a macOS notification appears on time (check Focus / Do Not Disturb). Clicking it shows the window with the task open. Only one notification appears.
- [ ] macOS asks for notification permission the first time (or check System Settings → Notifications → OpenThings).
- [ ] Settings → Desktop → Launch at login: log out and in; OpenThings starts hidden in the menu bar.
- [ ] ⌘Q quits; a to-do added right before ⌘Q is still there after relaunch.
- [ ] `open 'openthings://add?text=Hello%20from%20link'` opens quick add prefilled.

Arch / Hyprland:

- [ ] `makepkg -si` (openthings-bin) installs; the app shows in the launcher (and its "Quick Add" action).
- [ ] Settings → Desktop → **Use Super+Alt+Space** writes `~/.config/hypr/openthings.conf` and one `source` line in `hyprland.conf`; without a restart, Super+Alt+Space opens the floating, centered quick-add window; adding works; Esc hides it.
- [ ] Recording a key Omarchy already uses (e.g. Super+Return) shows an error and changes nothing. Recording a free one replaces the bind; **Turn off** removes it.
- [ ] With an AppImage, the bind runs the AppImage path.
- [ ] `openthings --add "From CLI"` adds to the Inbox while the app runs (toast appears).
- [ ] Waybar shows the tray icon and menu.
- [ ] A reminder fires as a mako notification with the window closed; clicking it opens the task.
- [ ] `xdg-open 'openthings://add?text=Hi'` opens quick add.

## Not done yet / follow-ups

- Ubuntu/Fedora packages (.deb/.rpm), Flatpak.
- A Windows build (the code compiles for Windows in principle; untested).
- Auto-update (tauri-plugin-updater) once releases are signed.
- Local notifications scheduled with the OS while the app is fully quit.
