#!/usr/bin/env bash
# Set the app version everywhere a release needs it.
# Run from the repo root:  scripts/bump-version.sh 0.2.2
# Then add a CHANGELOG.md entry and open a "Release vX.Y.Z" PR; merging it releases
# (see docs/desktop.md#releasing).
set -euo pipefail

new="${1:?usage: scripts/bump-version.sh X.Y.Z}"
if ! [[ "$new" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must be X.Y.Z, got: $new" >&2
  exit 1
fi
old="$(node -p "require('./src-tauri/tauri.conf.json').version")"

perl -pi -e "s/^  \"version\": \"\Q$old\E\",/  \"version\": \"$new\",/" package.json src-tauri/tauri.conf.json
perl -0pi -e "s/(\"name\": \"openthings\",\n  \"version\": )\"\Q$old\E\"/\$1\"$new\"/; s/(\"\": \{\n      \"name\": \"openthings\",\n      \"version\": )\"\Q$old\E\"/\$1\"$new\"/" package-lock.json
perl -pi -e "s/^version = \"\Q$old\E\"/version = \"$new\"/" src-tauri/Cargo.toml
perl -0pi -e "s/(name = \"openthings\"\nversion = )\"\Q$old\E\"/\$1\"$new\"/" src-tauri/Cargo.lock
perl -pi -e "s/^MARKETING_VERSION = \Q$old\E\$/MARKETING_VERSION = $new/" ios/App/Config/OpenThings.xcconfig

# Every file must now say $new; fail loudly if a pattern stopped matching.
bad=0
for f in package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock ios/App/Config/OpenThings.xcconfig; do
  git diff --quiet -- "$f" && { echo "Not updated: $f" >&2; bad=1; }
done
[ "$bad" = 0 ] || exit 1
echo "Bumped $old -> $new."
