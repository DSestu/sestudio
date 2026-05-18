{ pkgs, ... }:

{
  packages = [
    pkgs.yt-dlp
  ];

  languages.python = {
    enable = true;
    version = "3.11";
    uv = {
      enable = true;
      sync.enable = true;
    };
  };

  languages.javascript = {
    enable = true;
    npm.enable = true;
  };

  scripts.build.exec = ''
    cd "$DEVENV_ROOT/frontend"
    npm install
    npm run build
  '';
}
