---
name: release
description: Cut an OpenThings release (vX.Y.Z) — bump the version, open and merge the release PR, and verify the GitHub release, notarization, Homebrew cask and container image. Use when asked to release, ship, publish or tag a new version.
---

# Release OpenThings

Releasing is merging a version bump to `main`. The *Tag release* workflow (`.github/workflows/tag-release.yml`) then tags `vX.Y.Z` and starts Desktop and Container on the tag. Don't push tags yourself. Background: `docs/desktop.md#releasing`.

## Steps

1. Pick the version (patch for fixes, minor for features). Check what's unreleased:
   `git fetch origin --tags && git log --oneline $(git describe --tags --abbrev=0 origin/main)..origin/main`
   If nothing is unreleased, ask before releasing.
2. Branch from `origin/main` as `release-vX.Y.Z` and run `scripts/bump-version.sh X.Y.Z`.
3. Add a `## [vX.Y.Z](https://github.com/spuder/OpenThings/releases/tag/vX.Y.Z) - YYYY-MM-DD` entry at the top of `CHANGELOG.md`, in the existing style, linking each PR or issue.
4. Commit `Release vX.Y.Z`, push, open PR `Release vX.Y.Z`.
5. When all checks pass (Desktop takes about 20 minutes), merge with a merge commit.

If `git push` over SSH fails with `communication with agent failed` (the 1Password SSH agent wants an approval nobody can give), push over HTTPS with the `gh` login: `git push https://github.com/spuder/OpenThings.git <branch>`.

## Verify (don't report done before this)

- `gh run list -R spuder/OpenThings -w "Tag release" -L 1` succeeded, and `gh run list -R spuder/OpenThings -b vX.Y.Z` shows Desktop, Container and Android succeeded. If Tag release failed, read its log: it names any version file that doesn't match.
- `gh release view vX.Y.Z -R spuder/OpenThings` lists the `.dmg`, `.app.zip`, AppImage and Linux tarball.
- The macOS build is notarized: download the `.dmg` and `.app.zip`, then `spctl -a -vv -t exec OpenThings.app` and `spctl -a -vv -t open --context context:primary-signature <dmg>` both say `source=Notarized Developer ID`.
- `Casks/openthings.rb` in spuder/homebrew-openthings has `version "X.Y.Z"` (pushed by `github-actions[bot]`).
- `ghcr.io/spuder/openthings:X.Y.Z` exists.
- TestFlight: `gh run list -R spuder/OpenThings -w TestFlight -L 1` succeeded (or skipped with a notice if its secrets aren't set), and build X.Y.Z shows in App Store Connect → TestFlight (docs/testflight.md).
