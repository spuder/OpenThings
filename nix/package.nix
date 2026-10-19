# OpenThings desktop app (Tauri). Linux: bin/openthings plus .desktop file and icons.
# macOS: Applications/OpenThings.app, with bin/openthings pointing into it.
{
  lib,
  stdenv,
  rustPlatform,
  cargo-tauri,
  nodejs_22,
  importNpmLock,
  pkg-config,
  wrapGAppsHook3,
  glib-networking,
  libayatana-appindicator,
  openssl,
  webkitgtk_4_1,
  src,
  version,
}:

rustPlatform.buildRustPackage (finalAttrs: {
  pname = "openthings";
  inherit src version;

  # Dependencies come from the lockfiles in the tree, so there are no hashes to bump when they change.
  cargoRoot = "src-tauri";
  buildAndTestSubdir = finalAttrs.cargoRoot;
  cargoLock.lockFile = ../src-tauri/Cargo.lock;
  npmDeps = importNpmLock {
    package = lib.importJSON ../package.json;
    packageLock = lib.importJSON ../package-lock.json;
  };

  nativeBuildInputs = [
    cargo-tauri.hook
    nodejs_22
    importNpmLock.npmConfigHook
    pkg-config
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ wrapGAppsHook3 ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    glib-networking
    libayatana-appindicator
    openssl
    webkitgtk_4_1
  ];

  # tauri.conf.json asks for ad-hoc signing, which needs /usr/bin/codesign; the Nix linker
  # already signs the binary ad hoc.
  tauriBuildFlags = lib.optionals stdenv.hostPlatform.isDarwin [
    "--config"
    (builtins.toJSON { bundle.macOS.signingIdentity = null; })
  ];

  # The checks rebuild the whole crate graph; the Desktop workflow already runs `cargo test`.
  doCheck = false;

  # The tray icon loads libayatana-appindicator with dlopen.
  preFixup = lib.optionalString stdenv.hostPlatform.isLinux ''
    gappsWrapperArgs+=(--prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath [ libayatana-appindicator ]})
  '';

  postInstall = lib.optionalString stdenv.hostPlatform.isDarwin ''
    mkdir -p $out/bin
    ln -s $out/Applications/OpenThings.app/Contents/MacOS/openthings $out/bin/openthings
  '';

  meta = {
    description = "Self-hosted, local-first task manager with a calm, keyboard-first design";
    homepage = "https://github.com/spuder/OpenThings";
    license = lib.licenses.mit;
    mainProgram = "openthings";
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
})
