{
  description = "OpenThings: a self-hosted, local-first task manager";

  # 26.05 is the last Nixpkgs release that builds x86_64-darwin (Intel Macs); see docs/nix.md.
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs =
    { self, nixpkgs }:
    let
      inherit (nixpkgs) lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      version = (lib.importJSON ./package.json).version;

      # Only what each build reads, so editing docs or the iOS app doesn't rebuild everything.
      web = [
        ./package.json
        ./package-lock.json
        ./index.html
        ./vite.config.ts
        ./svelte.config.js
        ./tsconfig.json
        ./tsconfig.app.json
        ./tsconfig.node.json
        ./src
        ./public
        ./LICENSE
      ];
      source =
        extra:
        lib.fileset.toSource {
          root = ./.;
          fileset = lib.fileset.unions (web ++ extra);
        };
    in
    {
      overlays.default = final: _prev: {
        openthings = final.callPackage ./nix/package.nix {
          inherit version;
          src = source [ ./src-tauri ];
        };
        openthings-server = final.callPackage ./nix/server.nix {
          inherit version;
          src = source [
            ./server
            ./tsconfig.server.json
          ];
        };
      };

      packages = forAllSystems (
        pkgs:
        let
          ours = self.overlays.default pkgs pkgs;
        in
        {
          inherit (ours) openthings openthings-server;
          default = ours.openthings;
        }
      );

      nixosModules.default = import ./nix/module.nix self;

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
