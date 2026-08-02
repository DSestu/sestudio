"""The bare `sestudio` entrypoint defaults to serving the web UI."""

from __future__ import annotations

import pytest

from sestudio.cli import default_argv


@pytest.mark.parametrize(
    ("argv", "expected"),
    [
        # No arguments at all — the primary case.
        ([], ["serve"]),
        # Only flags: they belong to the implied `serve`.
        (["--port", "9000"], ["serve", "--port", "9000"]),
        (["--no-https"], ["serve", "--no-https"]),
        # An explicit command always wins.
        (["serve"], ["serve"]),
        (["serve", "--port", "9000"], ["serve", "--port", "9000"]),
        (["download", "https://example.test/s"], ["download", "https://example.test/s"]),
        # Help stays on the command group, so `download` remains discoverable.
        (["--help"], ["--help"]),
        (["-h"], ["-h"]),
    ],
)
def test_default_argv(argv: list[str], expected: list[str]) -> None:
    assert default_argv(argv) == expected


def test_help_for_a_command_is_untouched() -> None:
    """`sestudio serve --help` must document serve, not the group."""
    assert default_argv(["serve", "--help"]) == ["serve", "--help"]
