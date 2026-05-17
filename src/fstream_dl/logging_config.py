from __future__ import annotations

import logging

from rich.console import Console
from rich.logging import RichHandler


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
