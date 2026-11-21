"""Byte ranges of a file on a server (SPEC-storage §9.1): what the relay and the
downloaded-file route answer for a ``RemoteFile``, so seeking works as on disk."""

from __future__ import annotations

import re
from collections.abc import Iterator
from typing import Any

from fastapi import HTTPException, Request, Response
from fastapi.responses import StreamingResponse

CHUNK = 256 * 1024
_RANGE = re.compile(r"bytes=(\d*)-(\d*)")


def _span(header: str | None, size: int) -> tuple[int, int] | None:
    """(first, last) of a single ``Range``, or None for the whole file."""
    match = _RANGE.fullmatch((header or "").strip())
    if not match or not (match[1] or match[2]):
        return None
    if not match[1]:  # the last N bytes
        return max(0, size - int(match[2])), size - 1
    first = int(match[1])
    last = min(int(match[2]), size - 1) if match[2] else size - 1
    if first >= size or first > last:
        raise HTTPException(416, headers={"Content-Range": f"bytes */{size}"})
    return first, last


def _read(file: Any, first: int, count: int) -> Iterator[bytes]:
    with file.open("rb") as handle:
        handle.seek(first)
        while count > 0:
            chunk = handle.read(min(CHUNK, count))
            if not chunk:
                return
            count -= len(chunk)
            yield chunk


def ranged(
    request: Request, file: Any, media_type: str, headers: dict[str, str]
) -> Response:
    size = file.stat().st_size
    span = _span(request.headers.get("range"), size)
    first, last = span or (0, size - 1)
    headers = {
        **headers,
        "Accept-Ranges": "bytes",
        "Content-Length": str(last - first + 1),
    }
    status = 206 if span else 200
    if span:
        headers["Content-Range"] = f"bytes {first}-{last}/{size}"
    if request.method == "HEAD":
        return Response(status_code=status, media_type=media_type, headers=headers)
    return StreamingResponse(
        _read(file, first, last - first + 1),
        status_code=status,
        media_type=media_type,
        headers=headers,
    )
