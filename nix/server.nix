# OpenThings server: the web app plus sync, REST API and MCP in one Bun process (what the
# Docker image runs). Configured with PORT, DATA_DIR, OPENTHINGS_ALLOWED_ORIGINS and TZ.
{
  lib,
  stdenv,
  bun,
  nodejs_22,
  importNpmLock,
  makeWrapper,
  src,
  version,
}:

stdenv.mkDerivation {
  pname = "openthings-server";
  inherit src version;

  npmDeps = importNpmLock {
    package = lib.importJSON ../package.json;
    packageLock = lib.importJSON ../package-lock.json;
  };

  nativeBuildInputs = [
    bun
    nodejs_22
    importNpmLock.npmConfigHook
    makeWrapper
  ];

  buildPhase = ''
    runHook preBuild
    npm run build
    # One file, so the output needs no node_modules (same as the Dockerfile).
    HOME=$TMPDIR bun build server/index.ts --target=bun --outfile=server.js
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/share/openthings
    cp -r dist $out/share/openthings/public
    cp server.js $out/share/openthings/server.js
    makeWrapper ${lib.getExe bun} $out/bin/openthings-server \
      --add-flags $out/share/openthings/server.js \
      --set-default NODE_ENV production \
      --set-default STATIC_DIR $out/share/openthings/public
    runHook postInstall
  '';

  meta = {
    description = "OpenThings web app, sync server, REST API and MCP endpoint";
    homepage = "https://github.com/spuder/OpenThings";
    license = lib.licenses.mit;
    mainProgram = "openthings-server";
    platforms = bun.meta.platforms;
  };
}
