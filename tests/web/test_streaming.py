import asyncio
import gc
from collections.abc import AsyncIterator, Iterator

import pytest

from sestudio.web.streaming import ClosingStreamingResponse


def _leave_after_first_chunk(response, closed: list[str]) -> list[str]:
    """Play a client that takes one chunk, then goes away while it is slow:
    what was closed by the time the response ended."""
    got_one = asyncio.Event()

    async def send(message):
        if message["type"] == "http.response.body":
            got_one.set()
            await asyncio.sleep(10)

    async def receive():
        await got_one.wait()
        return {"type": "http.disconnect"}

    scope = {"type": "http", "asgi": {"spec_version": "2.3"}}

    async def respond() -> list[str]:
        await asyncio.wait_for(response(scope, receive, send), 5)
        # Read before the loop ends: closing the loop closes what was left.
        return list(closed)

    gc.disable()  # the leak was only freed when the collector got to it
    try:
        return asyncio.run(respond())
    finally:
        gc.enable()


def _endless(closed: list[str]) -> Iterator[bytes]:
    try:
        while True:
            yield b"x"
    finally:
        closed.append("sync")


async def _endless_async(closed: list[str]) -> AsyncIterator[bytes]:
    try:
        while True:
            yield b"x"
            await asyncio.sleep(0)
    finally:
        closed.append("async")


@pytest.mark.parametrize("body", [_endless, _endless_async])
def test_a_stream_the_client_leaves_frees_what_it_holds_at_once(body):
    """An abandoned segment's upstream connection went back to the pool only at
    garbage collection: leaving videos fast filled it and hung the server."""
    closed: list[str] = []
    response = ClosingStreamingResponse(body(closed))

    assert _leave_after_first_chunk(response, closed)
