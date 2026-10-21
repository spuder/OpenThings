# Changelog

Release notes for OpenThings. Each release is also published on [GitHub Releases](https://github.com/spuder/OpenThings/releases).

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
