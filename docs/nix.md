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

Pin a release with `github:spuder/OpenThings/v0.3.0`, or from FlakeHub with `https://flakehub.com/f/spuder/OpenThings/0.3.0` (any `0.3.*`: `…/OpenThings/0.3`).

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
- The only pin is nixpkgs in `flake.lock`. Nothing bumps it automatically: update it when you want a newer nixpkgs, with `nix flake update nixpkgs` in a PR, and the Nix workflow builds the result on all four platforms.
- `.github/workflows/nix.yml` builds both packages on all four platforms and smoke-tests the server.

### Intel Macs

nixpkgs 26.05 is the last release that builds `x86_64-darwin`; it is supported until the end of 2026, and 26.11 drops the platform. The flake follows `nixos-26.05` so Intel Macs keep working until then. When moving to 26.11, drop `x86_64-darwin` from `systems` in `flake.nix` and the `macos-15-intel` job in `nix.yml`.

## Publishing

Every release tag is published to **[FlakeHub](https://flakehub.com/flake/spuder/OpenThings)**, an index of flakes with semver versions: tag `v0.3.0` becomes version `0.3.0`. The *Tag release* workflow starts `.github/workflows/flakehub.yml` on each new tag, along with Desktop, Container and Nix (which builds the flake on all four platforms). The workflow checks that the flake evaluates, then publishes it with `DeterminateSystems/flakehub-push`.

- **Setup, once:** sign in at [flakehub.com](https://flakehub.com) with the GitHub account that owns the repo. The workflow authenticates with GitHub's OIDC token (`id-token: write`), so there's no secret to store.
- **Publish an existing tag again,** or one from before this workflow: Actions → FlakeHub → Run workflow, with the tag (e.g. `v0.3.0`).
- A flake on GitHub works without FlakeHub too: `nix run github:spuder/OpenThings` always does.

**nixpkgs**, Nix's main package collection (`nix-env -iA nixpkgs.openthings`, `pkgs.openthings` without a flake input), is a later, manual step. Getting in means a PR to [NixOS/nixpkgs](https://github.com/NixOS/nixpkgs) adding `pkgs/by-name/op/openthings/package.nix` for a tagged release. That file differs from `nix/package.nix`: it fetches a tag with `fetchFromGitHub` and pins `hash`, `cargoHash` and `npmDeps = fetchNpmDeps { hash = …; }` (nixpkgs doesn't read lockfiles from the source at evaluation time). The maintainer also adds themselves to `maintainers/maintainer-list.nix`. After that, nixpkgs' update bot ([r-ryantm / nixpkgs-update](https://wiki.nixos.org/wiki/Nixpkgs/Automatic_Updates)) opens a version-bump PR for each new GitHub release; add `passthru.updateScript = nix-update-script { };` so it can.
