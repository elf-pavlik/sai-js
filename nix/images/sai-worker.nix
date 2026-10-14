{ pkgs, ... }:

let
  sai-worker = pkgs.callPackage ../packages/sai-worker.nix {};
in

pkgs.dockerTools.buildImage {
  name = "quay.io/hackers4peace/sai-worker";
  tag = sai-worker.version;

  copyToRoot = pkgs.buildEnv {
    name = "root";
    paths = [
      pkgs.busybox
      pkgs.cacert
      pkgs.nodejs_26
      sai-worker
      ];
    pathsToLink = [ "/bin" "/app" "/etc" ];
  };

  config = {
    Cmd = [ "/bin/sai-worker" ];
    WorkingDir = "/app";
  };
}
