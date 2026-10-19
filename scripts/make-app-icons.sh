#!/usr/bin/env bash
# Regenerate the desktop app icons (src-tauri/icons) from the logo.
#
# Linux and Windows icons are full-bleed, from public/icon-512.png. The macOS
# icon.icns follows Apple's icon grid: the logo is 824 px on a 1024 px
# transparent canvas, so it sits at the same size as other apps in the Dock.
# Run from the repo root:  scripts/make-app-icons.sh
# Needs Inkscape and ImageMagick.
set -euo pipefail

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

npx tauri icon public/icon-512.png -o "$tmp/full"
inkscape docs/logo.svg --export-type=png --export-width=824 --export-filename="$tmp/logo-824.png"
magick "$tmp/logo-824.png" -background none -gravity center -extent 1024x1024 "$tmp/macos.png"
npx tauri icon "$tmp/macos.png" -o "$tmp/macos"

rm -rf "$tmp/full/android" "$tmp/full/ios"
cp "$tmp/full/"* src-tauri/icons/
cp "$tmp/macos/icon.icns" src-tauri/icons/icon.icns
