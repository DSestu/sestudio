"""A UPnP media server as a read-only storage (SPEC-storage §11, M5): a Freebox's
"Freebox Server", a NAS's DLNA server.

Its folders are browsed through its ContentDirectory; a file is an item with a
size (live TV channels and feeds have none, and are left out). A file is read
over HTTP from the address the server gives it, in byte ranges, so it plays,
seeks and copies like a file on any other server. Nothing is ever written to it.
"""

from __future__ import annotations

import asyncio
import html
import json
import mimetypes
import re
import threading
from pathlib import PurePosixPath
from typing import Any

from sestudio.config import config_dir
from sestudio.remotefs import RemoteFile, _Stat

#: How far down the folders are followed, and how many files at most.
MAX_DEPTH = 12
MAX_FILES = 20000
PAGE = 200
CONTENT_DIRECTORY = "urn:schemas-upnp-org:service:ContentDirectory:1"

_ENTRY = re.compile(r"<(container|item)\b([^>]*)>(.*?)</\1>", re.S)
_ID = re.compile(r'\bid="([^"]*)"')
_TITLE = re.compile(r"<dc:title>([^<]*)</dc:title>")
_RES = re.compile(r"<res\b([^>]*)>([^<]+)</res>")
_ATTR = re.compile(r'(\w+)="([^"]*)"')


def parse_didl(didl: str) -> list[dict[str, Any]]:
    """Containers and items of a DIDL-Lite page: ``{kind, id, title, url, size, mime}``."""
    out = []
    for kind, attrs, body in _ENTRY.findall(didl):
        oid = _ID.search(attrs)
        title = _TITLE.search(body)
        if not oid or not title:
            continue
        entry: dict[str, Any] = {"kind": kind, "id": html.unescape(oid.group(1)),
                                 "title": html.unescape(title.group(1)).strip()}  # fmt: skip
        if kind == "item":
            for res_attrs, url in _RES.findall(body):
                a = dict(_ATTR.findall(res_attrs))
                if not a.get("size", "").isdigit() or int(a["size"]) <= 0:
                    continue  # a stream (a TV channel, size 0 or none): not a file
                proto = a.get("protocolInfo", "").split(":")
                entry |= {"url": html.unescape(url.strip()), "size": int(a["size"]),
                          "mime": proto[2] if len(proto) > 2 else ""}  # fmt: skip
                break
        out.append(entry)
    return out


def _clean(name: str) -> str:
    return name.replace("/", "∕").strip() or "untitled"


#: Extensions by media type: the system's own table lacks most video types.
_SUFFIX_BY_MIME = {
    "video/x-matroska": ".mkv", "video/mp4": ".mp4", "video/x-msvideo": ".avi", "video/avi": ".avi",
    "video/mpeg": ".mpg", "video/mp2t": ".ts", "video/vnd.dlna.mpeg-tts": ".ts", "video/quicktime": ".mov",
    "video/x-ms-wmv": ".wmv", "video/webm": ".webm", "video/x-flv": ".flv", "video/3gpp": ".3gp",
    "audio/mpeg": ".mp3", "audio/flac": ".flac", "audio/x-flac": ".flac", "audio/mp4": ".m4a",
    "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/x-wav": ".wav",
}  # fmt: skip


def _media_suffixes() -> set[str]:
    from sestudio.downloaded import _AUDIO_SUFFIXES, _VIDEO_SUFFIXES

    return set(_VIDEO_SUFFIXES) | set(_AUDIO_SUFFIXES)


def _file_name(entry: dict[str, Any]) -> str:
    """The item's title with a media extension: its own when it has one ("Mr. Robot"
    has none), else its URL's, else its type's."""
    name = _clean(entry["title"])
    known = _media_suffixes()
    if PurePosixPath(name).suffix.lower() in known:
        return name
    suffix = PurePosixPath(entry["url"].split("?", 1)[0]).suffix.lower()
    if suffix not in known:
        mime = (entry.get("mime") or "").lower()
        suffix = _SUFFIX_BY_MIME.get(mime) or mimetypes.guess_extension(mime) or ""
    return name + suffix


def browse(location: str, timeout: float = 10.0) -> list[dict[str, Any]]:
    """Every file the server lists: ``{path, url, size}``, paths built from folder titles."""
    from async_upnp_client.aiohttp import AiohttpRequester
    from async_upnp_client.client_factory import UpnpFactory

    async def run() -> list[dict[str, Any]]:
        device = await UpnpFactory(
            AiohttpRequester(timeout=timeout)
        ).async_create_device(location)
        action = device.service(CONTENT_DIRECTORY).action("Browse")
        files: list[dict[str, Any]] = []
        seen: set[str] = set()

        async def walk(oid: str, folder: tuple[str, ...]) -> None:
            if len(folder) > MAX_DEPTH or len(files) >= MAX_FILES or oid in seen:
                return
            seen.add(oid)
            start = 0
            while True:
                r = await action.async_call(ObjectID=oid, BrowseFlag="BrowseDirectChildren", Filter="*",
                                            StartingIndex=start, RequestedCount=PAGE, SortCriteria="")  # fmt: skip
                entries = parse_didl(r["Result"])
                for e in entries:
                    if e["kind"] == "container":
                        await walk(e["id"], (*folder, _clean(e["title"])))
                    elif e.get("url"):
                        path = "/".join((*folder, _file_name(e)))
                        files.append({"path": path, "url": e["url"], "size": e["size"]})
                start += int(r.get("NumberReturned") or len(entries))
                if not entries or start >= int(r.get("TotalMatches") or 0):
                    return

        await walk("0", ())
        return files

    return asyncio.run(run())


class HttpReader:
    """A file read over HTTP: ``seek`` starts a new ranged request where it is
    asked, ``read`` streams from there. What ``ranged``, the transfers and the
    stills read a media server's file with."""

    def __init__(self, url: str) -> None:
        self.url, self._pos, self._response, self._chunks, self._buffer = (
            url,
            0,
            None,
            None,
            b"",
        )
        import httpx

        self._client = httpx.Client(
            timeout=httpx.Timeout(15.0, read=60.0), follow_redirects=True
        )

    def seek(self, offset: int, whence: int = 0) -> int:
        if whence != 0:
            raise OSError("only absolute seeks")
        if offset != self._pos or self._response is None:
            self._close_response()
            self._pos = offset
        return self._pos

    def tell(self) -> int:
        return self._pos

    def _open(self) -> None:
        headers = {"Range": f"bytes={self._pos}-"} if self._pos else {}
        request = self._client.build_request("GET", self.url, headers=headers)
        self._response = self._client.send(request, stream=True)
        if self._response.status_code >= 400:
            raise OSError(f"the media server answered {self._response.status_code}")
        if self._pos and self._response.status_code != 206:
            raise OSError("the media server does not seek")
        self._chunks = self._response.iter_raw()
        self._buffer = b""

    def read(self, size: int = -1) -> bytes:
        if self._response is None:
            self._open()
        while size < 0 or len(self._buffer) < size:
            chunk = next(self._chunks, None)
            if chunk is None:
                break
            self._buffer += chunk
        if size < 0:
            out, self._buffer = self._buffer, b""
        else:
            out, self._buffer = self._buffer[:size], self._buffer[size:]
        self._pos += len(out)
        return out

    def _close_response(self) -> None:
        if self._response is not None:
            self._response.close()
        self._response, self._chunks, self._buffer = None, None, b""

    def close(self) -> None:
        self._close_response()
        self._client.close()

    def __enter__(self) -> HttpReader:
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()


# --- the server's files as a folder tree, for the scan and the players -----------


#: Each media server's files by path ("/Fichiers/Films/x.mkv": {url, size});
#: its folders map to None. Rebuilt at each scan, kept on disk for when it is away.
_index: dict[str, dict[str, dict[str, Any] | None]] = {}
_lock = threading.Lock()


def _index_file(storage_id: str):
    return config_dir() / "storage" / f"{storage_id}.upnp.json"


def load(s: dict[str, Any]) -> None:
    """Browse the server again and keep what it lists."""
    index: dict[str, dict[str, Any] | None] = {"/": None}
    for f in browse(s["url"]):
        path = PurePosixPath("/" + f["path"])
        index[str(path)] = {"url": f["url"], "size": f["size"]}
        for parent in path.parents:
            index.setdefault(str(parent), None)
    with _lock:
        _index[s["id"]] = index
    try:
        _index_file(s["id"]).parent.mkdir(parents=True, exist_ok=True)
        _index_file(s["id"]).write_text(json.dumps(index), "utf-8")
    except OSError:
        pass


def index_of(s: dict[str, Any]) -> dict[str, dict[str, Any] | None]:
    with _lock:
        if s["id"] in _index:
            return _index[s["id"]]
    try:
        index = json.loads(_index_file(s["id"]).read_text("utf-8"))
    except (OSError, ValueError):
        index = {"/": None}
    with _lock:
        _index[s["id"]] = index
    return index


def forget(storage_id: str) -> None:
    with _lock:
        _index.pop(storage_id, None)
    _index_file(storage_id).unlink(missing_ok=True)


class UpnpFile(RemoteFile):
    """A path on a media server, answered from what it listed: read over HTTP,
    never written (spec §11, M5)."""

    def _entry_of(self) -> tuple[bool, dict[str, Any] | None]:
        index = index_of(self.storage)
        key = str(self)
        return key in index, index.get(key)

    def stat(self) -> _Stat:
        known, entry = self._entry_of()
        if not known:
            raise FileNotFoundError(str(self))
        return _Stat(int(entry["size"]) if entry else 0, 0.0)

    def exists(self) -> bool:
        return self._entry_of()[0]

    def is_dir(self) -> bool:
        known, entry = self._entry_of()
        return known and entry is None

    def is_file(self) -> bool:
        known, entry = self._entry_of()
        return known and entry is not None

    def iterdir(self) -> Any:
        here = str(self)
        for path in index_of(self.storage):
            if path != here and str(PurePosixPath(path).parent) == here:
                yield type(self)(path, storage=self.storage)

    def glob(self, pattern: str) -> Any:  # type: ignore[override]
        return iter(())  # no sidecar subtitles on a media server

    def relative(self) -> str:
        return self.as_posix().lstrip("/")

    @property
    def url(self) -> str:
        _known, entry = self._entry_of()
        if not entry:
            raise FileNotFoundError(str(self))
        return entry["url"]

    def open(self, mode: str = "rb", **kw: Any) -> Any:  # type: ignore[override]
        if mode != "rb":
            raise PermissionError("A media server is read only")
        return HttpReader(self.url)

    def unlink(self, missing_ok: bool = False) -> None:
        raise PermissionError("A media server is read only")


def top(s: dict[str, Any]) -> UpnpFile:
    return UpnpFile("/", storage=s)
