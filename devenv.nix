{pkgs, ...}: {
  packages = [
  ];

  languages.python = {
    enable = true;
    uv = {
      enable = true;
      sync.enable = true;
    };
  };

  languages.javascript = {
    enable = true;
    npm.enable = true;
  };

  scripts.start.exec = ''
    build
    uvx --with-editable "$DEVENV_ROOT" sestudio serve "$@"
  '';

  scripts.build.exec = ''
    cd "$DEVENV_ROOT/frontend"
    npm install
    npm run build
  '';

  scripts.lint.exec = ''
    cd "$DEVENV_ROOT/frontend"
    npm run lint
  '';
}
