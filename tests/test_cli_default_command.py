"""The bare `sestudio` entrypoint runs the web server; `-h` shows its options."""

from __future__ import annotations

import inspect
from unittest.mock import patch

from sestudio import cli


def test_serve_is_the_entrypoint() -> None:
    """`main` hands the serve function straight to Fire, so bare `sestudio` serves
    and `sestudio -h` documents serve's own options."""
    with patch("sestudio.cli.Fire") as mock_fire, patch.object(cli.sys, "argv", ["sestudio"]):
        cli.main()
    mock_fire.assert_called_once()
    assert mock_fire.call_args.args[0] is cli.serve


def test_dash_h_is_normalised_to_help() -> None:
    """`-h` collides with Fire's flag abbreviations, so main rewrites it to --help."""
    with patch("sestudio.cli.Fire") as mock_fire, patch.object(cli.sys, "argv", ["sestudio", "-h"]):
        cli.main()
    assert mock_fire.call_args.kwargs["command"] == ["--help"]


def test_leading_serve_token_is_stripped() -> None:
    """`sestudio serve ...` stays backward-compatible: the leading `serve` is
    dropped so its flags bind correctly (not swallowed into a positional)."""
    with patch("sestudio.cli.Fire") as mock_fire, patch.object(
        cli.sys, "argv", ["sestudio", "serve", "--http-port", "8081"]
    ):
        cli.main()
    assert mock_fire.call_args.kwargs["command"] == ["--http-port", "8081"]


def test_serve_exposes_symmetric_http_and_https_ports() -> None:
    params = inspect.signature(cli.serve).parameters
    assert "http_port" in params
    assert "https_port" in params
    # The old ambiguous --port is gone in favour of the explicit --https-port.
    assert "port" not in params


def test_download_command_removed() -> None:
    """The CLI no longer exposes a `download` command or the old command group."""
    assert not hasattr(cli, "Entrypoint")
    assert not hasattr(cli, "default_argv")
