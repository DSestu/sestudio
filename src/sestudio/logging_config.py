from __future__ import annotations

import collections
import logging
import threading

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


class LogBuffer(logging.Handler):
    """The last lines the server logged, numbered, for the Settings page."""

    def __init__(self, size: int = 1000) -> None:
        super().__init__()
        self._lines: collections.deque[dict[str, int | str]] = collections.deque(
            maxlen=size
        )
        self._seq = 0
        self._guard = threading.Lock()
        self.setFormatter(logging.Formatter("%(asctime)s %(message)s", "%H:%M:%S"))

    def emit(self, record: logging.LogRecord) -> None:
        # The panel's own polling, every 2 s, would bury everything else.
        if "/api/server/log" in str(record.args):
            return
        try:
            text = self.format(record)
        except Exception:
            self.handleError(record)
            return
        with self._guard:
            self._seq += 1
            self._lines.append(
                {"seq": self._seq, "level": record.levelname, "text": text}
            )

    def since(self, after: int) -> list[dict[str, int | str]]:
        """Lines numbered above *after*, oldest first."""
        with self._guard:
            return [line for line in self._lines if int(line["seq"]) > after]


LOG_BUFFER = LogBuffer()


def capture_logs() -> None:
    """Copy what the terminal shows into LOG_BUFFER. After uvicorn has set up
    its own loggers, which do not pass their lines on to the root one."""
    for name in ("", "uvicorn", "uvicorn.access"):
        logger = logging.getLogger(name)
        if LOG_BUFFER not in logger.handlers:
            logger.addHandler(LOG_BUFFER)
