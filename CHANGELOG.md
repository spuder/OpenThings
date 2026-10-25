# Changelog

Release notes for OpenThings. Each release is also published on [GitHub Releases](https://github.com/spuder/OpenThings/releases).

## [v0.7.0](https://github.com/spuder/OpenThings/releases/tag/v0.7.0) - 2026-10-25

### What's Changed

* Swipe gestures on phones and tablets: swipe a to-do right for Complete or Move to…, or left for Move to Trash, from a small sheet that keeps the to-do outlined. Move to Trash shows Undo in the toast. By @Copilot and @spuder in https://github.com/spuder/OpenThings/pull/76 (https://github.com/spuder/OpenThings/issues/75)
* Delete project, Delete area and Empty Trash now work in the macOS app: they confirm in the command palette instead of a browser dialog the app couldn't show. By @spuder in https://github.com/spuder/OpenThings/pull/83 (https://github.com/spuder/OpenThings/issues/78)

**Full Changelog**: https://github.com/spuder/OpenThings/compare/v0.6.0...v0.7.0

## [v0.6.0](https://github.com/spuder/OpenThings/releases/tag/v0.6.0) - 2026-10-24

### What's Changed

* The desktop and web apps show the app version in small text at the bottom right. By @spuder in https://github.com/spuder/OpenThings/pull/82 (https://github.com/spuder/OpenThings/issues/81)
* Settings has an About section with the version and platform, such as "OpenThings v0.6.0 · iOS app", on every platform. By @spuder in https://github.com/spuder/OpenThings/pull/84

**Full Changelog**: https://github.com/spuder/OpenThings/compare/v0.5.0...v0.6.0

## [v0.5.0](https://github.com/spuder/OpenThings/releases/tag/v0.5.0) - 2026-10-24

### What's Changed

* Android app: the Capacitor shell with reminders, links, QR pairing for sync, share to OpenThings, Today and Sync status widgets, the back button, dark mode and app shortcuts. Releases include signed APKs. Not yet tested on a real phone. By @spuder in https://github.com/spuder/OpenThings/pull/53 (https://github.com/spuder/OpenThings/issues/6)
* Brain Dump sections can be removed with the × next to their heading or ⇧⌫, and ⌘Z brings one back. A section also falls off on its own 48 hours after its last to-do was added. Project headings can be removed the same way, or from the list menu (⇧L). By @Copilot and @spuder in https://github.com/spuder/OpenThings/pull/68 (https://github.com/spuder/OpenThings/issues/67)
* Shortcuts: quick add is `N` (`Q` is gone), New project is ⌘⇧N, and ⇧H adds a heading in a project, a section in the Brain Dump or a habit in Habits. ⇧N is no longer used. By @spuder in https://github.com/spuder/OpenThings/pull/68
* The macOS app icon no longer shows dark bars along its edges in the ⌘Tab switcher. By @spuder in https://github.com/spuder/OpenThings/pull/70 (https://github.com/spuder/OpenThings/issues/69)
* A root-level `logo.PNG` for repository previews. By @Copilot in https://github.com/spuder/OpenThings/pull/73 (https://github.com/spuder/OpenThings/issues/71)

**Full Changelog**: https://github.com/spuder/OpenThings/compare/v0.4.2...v0.5.0

## [v0.4.2](https://github.com/spuder/OpenThings/releases/tag/v0.4.2) - 2026-10-23

### What's Changed

* Version bump only; no user-facing changes.

**Full Changelog**: https://github.com/spuder/OpenThings/compare/v0.4.1...v0.4.2

## [v0.4.1](https://github.com/spuder/OpenThings/releases/tag/v0.4.1) - 2026-10-22

### What's Changed

* Moving a to-do to the Trash or emptying the Trash plays a short paper crumple, synthesized like the completion chime and muted with ⇧M. By @spuder in https://github.com/spuder/OpenThings/pull/62 (https://github.com/spuder/OpenThings/issues/61)
* On a phone, the open to-do's buttons wrap onto a second row, so Done is no longer cut off. By @Copilot in https://github.com/spuder/OpenThings/pull/64 (https://github.com/spuder/OpenThings/issues/63)
* Nix CI caches its builds in the GitHub Actions cache, so the Nix jobs finish sooner. By @spuder in https://github.com/spuder/OpenThings/pull/59

**Full Changelog**: https://github.com/spuder/OpenThings/compare/v0.4.0...v0.4.1

## [v0.4.0](https://github.com/spuder/OpenThings/releases/tag/v0.4.0) - 2026-10-22

### What's Changed

* Repeating to-dos: a repeat editor (⇧W, the repeat button on an open to-do, or right-click) for daily, weekly on chosen days, monthly on days of the month or a weekday such as the 2nd Tuesday, and yearly, every N periods, ending never, after N times or on a date, with a preview of the next dates. Quick add takes the new forms too, such as `*mon,thu` and `*1st,15th`. By @spuder in https://github.com/spuder/OpenThings/pull/52 (https://github.com/spuder/OpenThings/issues/37)
* Nix flake: `nix run github:spuder/OpenThings` installs the desktop app or the server on Linux and macOS (x86_64 and aarch64), with a NixOS module. Each release tag is also published to FlakeHub. By @spuder in https://github.com/spuder/OpenThings/pull/27 (https://github.com/spuder/OpenThings/issues/12)
* Move to Trash takes the to-do off the list right away again; since multi-select it stayed until the list reloaded. By @spuder in https://github.com/spuder/OpenThings/pull/57 (https://github.com/spuder/OpenThings/issues/56)
* How to use Siri and Shortcuts on iPhone is documented in [docs/ios.md](docs/ios.md#siri-and-shortcuts). By @spuder in https://github.com/spuder/OpenThings/pull/51 (https://github.com/spuder/OpenThings/issues/42)
* Desktop builds finish sooner: the Arch Linux CI work runs as three parallel jobs. By @spuder in https://github.com/spuder/OpenThings/pull/50

**Full Changelog**: https://github.com/spuder/OpenThings/compare/v0.3.0...v0.4.0

## [v0.3.0](https://github.com/spuder/OpenThings/releases/tag/v0.3.0) - 2026-10-20

### What's Changed

* Select several to-dos at once: Shift+click, ⌘/Ctrl+click and Shift+arrows on desktop, press and hold on a phone. Drag the selection to a new position or onto a list, or complete, schedule, move or delete them together, each as one undo step. Clicking empty space clears the selection. Move now offers every top-level list, leaving out lists whose feature is turned off. By @spuder in https://github.com/spuder/OpenThings/pull/46 (https://github.com/spuder/OpenThings/issues/36)
* `openthings://` links for Automator, Shortcuts and scripts: `openthings://add` takes a title, notes, when, deadline, tags and list, and `save=1` adds without opening quick add. List links such as `openthings://today` work in both the desktop and iOS apps. See [docs/url-scheme.md](docs/url-scheme.md). By @spuder in https://github.com/spuder/OpenThings/pull/47 (https://github.com/spuder/OpenThings/issues/35)
* Pair a phone by scanning a QR code: Settings → Sync on desktop and web shows one once this device has synced with a reachable server, and the iOS app scans it. The server's new `OPENTHINGS_PUBLIC_URL` setting gives the address devices use. By @spuder in https://github.com/spuder/OpenThings/pull/44 (https://github.com/spuder/OpenThings/issues/43)
* The README's self-hosting section shows the `compose.yaml` sample, with `TZ`. By @spuder in https://github.com/spuder/OpenThings/pull/45

**Full Changelog**: https://github.com/spuder/OpenThings/compare/v0.2.2...v0.3.0

## [v0.2.2](https://github.com/spuder/OpenThings/releases/tag/v0.2.2) - 2026-10-19

### What's Changed

* Releases are automatic: merging a version bump to `main` tags it and publishes the desktop builds, the Homebrew cask and the container image. Only commits on `main` can be released. `scripts/bump-version.sh` sets the version everywhere. By @spuder in https://github.com/spuder/OpenThings/pull/39

**Full Changelog**: https://github.com/spuder/OpenThings/compare/v0.2.1...v0.2.2

## [v0.2.1](https://github.com/spuder/OpenThings/releases/tag/v0.2.1) - 2026-10-19

### What's Changed

* The desktop app uses the new logo. The macOS icon is padded to Apple's icon grid so it matches other apps in the Dock. By @spuder in https://github.com/spuder/OpenThings/pull/32
* The Homebrew cask no longer warns that OpenThings isn't notarized. Releases have been notarized since v0.2.0. (https://github.com/spuder/OpenThings/issues/31)

**Full Changelog**: https://github.com/spuder/OpenThings/compare/v0.2.0...v0.2.1

## [v0.2.0](https://github.com/spuder/OpenThings/releases/tag/v0.2.0) - 2026-10-19

### What's Changed

* macOS releases can be signed and notarized when the required Apple credentials are configured. The release workflow now checks notarization. By @spuder in https://github.com/spuder/OpenThings/pull/25
* Updated Arch Linux package checksums and installation guidance. By @spuder in https://github.com/spuder/OpenThings/pull/26
* Fixed Homebrew instructions so users trust the tap before installing. By @Copilot in https://github.com/spuder/OpenThings/pull/29

**Full Changelog**: https://github.com/spuder/OpenThings/compare/v0.1.0...v0.2.0

## [v0.1.0](https://github.com/spuder/OpenThings/releases/tag/v0.1.0)

### What's Changed

* Site: remove em dashes from the webpage copy by @spuder in https://github.com/spuder/OpenThings/pull/9
* Settings → Features: toggle Brain Dump and a new This Week view by @spuder in https://github.com/spuder/OpenThings/pull/10
* iOS app: Capacitor shell, local notifications, widgets, share sheet, Shortcuts by @spuder in https://github.com/spuder/OpenThings/pull/4
* Import Things 3 databases by @spuder in https://github.com/spuder/OpenThings/pull/14
* Remove demo data and the reset button by @spuder in https://github.com/spuder/OpenThings/pull/15
* Show feature icons in Settings and recolor This Week by @spuder in https://github.com/spuder/OpenThings/pull/18
* Show a toast when shortcuts move or flag a to-do by @spuder in https://github.com/spuder/OpenThings/pull/16
* Progressive tag autocomplete in quick add by @spuder in https://github.com/spuder/OpenThings/pull/17
* Tap to accept the tag suggestion in quick add by @spuder in https://github.com/spuder/OpenThings/pull/19
* Desktop app (Tauri): macOS and Arch Linux / Hyprland by @spuder in https://github.com/spuder/OpenThings/pull/5
* Add a white and black outline to the logo by @spuder in https://github.com/spuder/OpenThings/pull/22
* Sync server, REST API and MCP endpoint by @spuder in https://github.com/spuder/OpenThings/pull/20
* Publish macOS builds through a Homebrew tap by @spuder in https://github.com/spuder/OpenThings/pull/23

**Full Changelog**: https://github.com/spuder/OpenThings/commits/v0.1.0
