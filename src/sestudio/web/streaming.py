from __future__ import annotations

from collections.abc import AsyncIterable, AsyncIterator, Iterable, Iterator
from typing import Any

from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool
from starlette.types import Receive, Scope, Send


class ClosingStreamingResponse(StreamingResponse):
    """A StreamingResponse whose body is closed as soon as the response ends.

    Starlette leaves the body suspended when the client goes away, so the
    ``finally`` that frees its upstream connection, file or ffmpeg waited for
    the garbage collector. Leaving a video fast abandoned enough segments to
    fill the proxy's connection pool, and every worker thread then hung on it
    until the server was restarted.
    """

    def __init__(
        self, content: Iterable[bytes] | AsyncIterable[bytes], *args: Any, **kwargs: Any
    ) -> None:
        if not isinstance(content, AsyncIterable):
            content = _closing(iter(content))
        super().__init__(content, *args, **kwargs)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            if aclose := getattr(self.body_iterator, "aclose", None):
                await aclose()


async def _closing(chunks: Iterator[bytes]) -> AsyncIterator[bytes]:
    """*chunks* read in a worker thread, closed however the stream ends."""
    try:
        while (chunk := await run_in_threadpool(next, chunks, None)) is not None:
            yield chunk
    finally:
        # A cancelled read waits for its thread, so nothing is reading here.
        if close := getattr(chunks, "close", None):
            close()
