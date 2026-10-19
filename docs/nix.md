# Nix

OpenThings ships a [flake](../flake.nix) with two packages, built for `x86_64-linux`, `aarch64-linux`, `aarch64-darwin` (Apple silicon) and `x86_64-darwin` (Intel Mac):

| Package | What it is |
| --- | --- |
| `openthings` (default) | The [desktop app](desktop.md). Linux: `bin/openthings`, `.desktop` file (deep links, Quick Add action) and icons. macOS: `Applications/OpenThings.app`, plus `bin/openthings` |
| `openthings-server` | The server from the Docker image: web app, sync, REST API and MCP in one Bun process. Same environment variables (`PORT`, `DATA_DIR`, `OPENTHINGS_ALLOWED_ORIGINS`, `TZ`) |

Nix runs on Linux (any distro, and NixOS) and macOS. It is not tied to either.

## Use it

```sh
nix run github:spuder/OpenThings                          # desktop app
nix run github:spuder/OpenThings#openthings-server        # server on :8080, data in ./data
nix profile install github:spuder/OpenThings              # install the desktop app
```

Pin a release with `github:spuder/OpenThings/v0.1.0`.

### NixOS

```nix
# flake.nix
{
  inputs.openthings.url = "github:spuder/OpenThings";

  outputs = { nixpkgs, openthings, ... }: {
    nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
      modules = [
        openthings.nixosModules.default
        {
          services.openthings = {
            enable = true;        # server, data in /var/lib/openthings
            port = 8080;
            openFirewall = true;
          };
          # Desktop app:
          environment.systemPackages = [ openthings.packages.x86_64-linux.openthings ];
        }
      ];
    };
  };
}
```

`overlays.default` adds `pkgs.openthings` and `pkgs.openthings-server` instead, for nix-darwin or Home Manager.

## How the build works

- `nix/package.nix`: Tauri with nixpkgs' `cargo-tauri.hook`, which runs `tauri build` (and so `npm run build`) and installs the `.deb` contents on Linux or the `.app` on macOS. On Linux it wraps the binary with GTK/WebKit paths and `libayatana-appindicator` for the tray. On macOS it skips the ad-hoc `codesign` step from `tauri.conf.json`, since the Nix linker already signs ad hoc.
- `nix/server.nix`: `npm run build`, then `bun build server/index.ts` into one file, as the Dockerfile does.
- npm and Cargo dependencies come from `package-lock.json` (`importNpmLock`) and `src-tauri/Cargo.lock` (`cargoLock.lockFile`). There are **no dependency hashes to keep up to date**: changing either lockfile just works.
- The only pin is nixpkgs in `flake.lock`, bumped weekly by a PR from `.github/workflows/flake-lock.yml` (`DeterminateSystems/update-flake-lock`). That PR only triggers CI if the repo has a `FLAKE_LOCK_TOKEN` secret (a fine-grained token with contents and pull-request write access); with the default token, close and reopen the PR to run CI. Settings → Actions → General must allow GitHub Actions to create pull requests.
- `.github/workflows/nix.yml` builds both packages on all four platforms and smoke-tests the server.

### Intel Macs

nixpkgs 26.05 is the last release that builds `x86_64-darwin`; it is supported until the end of 2026, and 26.11 drops the platform. The flake follows `nixos-26.05` so Intel Macs keep working until then. When moving to 26.11, drop `x86_64-darwin` from `systems` in `flake.nix` and the `macos-15-intel` job in `nix.yml`.

## Publishing

There is no separate registry to upload to: a flake on GitHub is installable as is (`github:spuder/OpenThings`). Two optional extras:

- **nixpkgs** (`nix-env -iA nixpkgs.openthings`, `pkgs.openthings` without adding a flake input). nixpkgs is the package registry for Nix. Getting in means a PR to [NixOS/nixpkgs](https://github.com/NixOS/nixpkgs) adding `pkgs/by-name/op/openthings/package.nix`, after a tagged release exists. That file differs from `nix/package.nix`: it fetches a tag with `fetchFromGitHub` and pins `hash`, `cargoHash` and `npmDeps = fetchNpmDeps { hash = …; }` (nixpkgs doesn't read lockfiles from the source at evaluation time). The maintainer also adds themselves to `maintainers/maintainer-list.nix`. Once merged, nixpkgs' update bot ([r-ryantm / nixpkgs-update](https://wiki.nixos.org/wiki/Nixpkgs/Automatic_Updates)) watches GitHub releases and opens version-bump PRs with new hashes; add `passthru.updateScript = nix-update-script { };` so it can. No GitHub Action is needed in this repo for that.
- **FlakeHub** ([flakehub.com](https://flakehub.com)): an index of flakes with semver versions, published from a tag by `DeterminateSystems/flakehub-push`. Not needed for `nix run github:…`.
