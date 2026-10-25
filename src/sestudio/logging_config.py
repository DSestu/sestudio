from __future__ import annotations

import logging

from rich.console import Console
from rich.logging import RichHandler


def _not_a_closed_player(record: logging.LogRecord) -> bool:
    """False for asyncio's report of a client that hung up: on Windows its
    Proactor loop logs the reset of every request a player aborts (hls.js does
    on a seek or a quality switch) as an error, though nothing went wrong."""
    exc = record.exc_info[1] if record.exc_info else None
    return not isinstance(exc, ConnectionResetError)


def setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.WARNING
    logging.basicConfig(
        level=level,
        format="%(message)s",
        datefmt="[%X]",
        handlers=[
            RichHandler(
                console=Console(stderr=True),
                rich_tracebacks=True,
                show_path=verbose,
                markup=True,
            )
        ],
    )
    logging.getLogger("asyncio").addFilter(_not_a_closed_player)
