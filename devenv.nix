{pkgs, ...}: {
  packages = [
    pkgs.pre-commit
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

  # Install the git pre-commit hook so `git commit` runs .pre-commit-config.yaml.
  # Idempotent; runs in the devenv shell where python, npm and pre-commit are all
  # on PATH (the hooks — ruff, frontend-build — need them). We manage the hook
  # config by hand, so devenv's git-hooks integration is intentionally not used.
  enterShell = ''
    if [ -d .git ] && [ ! -f .git/hooks/pre-commit ]; then
      pre-commit install >/dev/null
    fi
  '';

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
