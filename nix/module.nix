# NixOS service for the OpenThings server: `services.openthings.enable = true;`
self:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.openthings;
in
{
  options.services.openthings = {
    enable = lib.mkEnableOption "the OpenThings server (web app, sync, REST API and MCP)";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.openthings-server;
      defaultText = lib.literalExpression "openthings.packages.\${system}.openthings-server";
      description = "The openthings-server package to run.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8080;
      description = "Port to listen on (all interfaces).";
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Open the port in the firewall.";
    };

    allowedOrigins = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      example = [ "https://spuder.github.io" ];
      description = "Extra browser origins allowed to call the API.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.openthings = {
      description = "OpenThings server";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      environment = {
        PORT = toString cfg.port;
        DATA_DIR = "/var/lib/openthings";
        OPENTHINGS_ALLOWED_ORIGINS = lib.concatStringsSep "," cfg.allowedOrigins;
      };
      serviceConfig = {
        ExecStart = lib.getExe cfg.package;
        DynamicUser = true;
        StateDirectory = "openthings";
        Restart = "on-failure";
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
      };
    };

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];
  };
}
