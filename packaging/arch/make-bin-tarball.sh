#!/usr/bin/env bash
# Package a built Linux binary as openthings-<version>-linux-<arch>.tar.gz, the release asset the
# openthings-bin PKGBUILD installs. Run from the repo root after `npx tauri build`:
#   packaging/arch/make-bin-tarball.sh 0.1.0 src-tauri/target/release/openthings dist-linux
set -euo pipefail
version=$1
binary=$2
out=${3:-dist-linux}
arch=$(uname -m)
name="openthings-$version"
stage=$(mktemp -d)
mkdir -p "$stage/$name/icons" "$out"
install -m755 "$binary" "$stage/$name/openthings"
install -m644 packaging/arch/openthings.desktop "$stage/$name/openthings.desktop"
install -m644 src-tauri/icons/32x32.png "$stage/$name/icons/32.png"
install -m644 src-tauri/icons/128x128.png "$stage/$name/icons/128.png"
install -m644 src-tauri/icons/128x128@2x.png "$stage/$name/icons/256.png"
install -m644 src-tauri/icons/icon.png "$stage/$name/icons/512.png"
install -m644 LICENSE "$stage/$name/LICENSE"
tar -C "$stage" -czf "$out/$name-linux-$arch.tar.gz" "$name"
rm -rf "$stage"
echo "$out/$name-linux-$arch.tar.gz"
