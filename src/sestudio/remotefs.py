"""FTP, SFTP and SMB storages, read in the app (SPEC-storage §9, X1).

One fsspec filesystem per storage, made from its fields and its password in the
vault. Everything that touches the network goes through here, so a test swaps
``filesystem`` for an in-memory one.
"""

from __future__ import annotations

import posixpath
from pathlib import PurePosixPath
from urllib.parse import quote
import threading
from typing import Any

import fsspec

from sestudio import vault

FTP, SFTP, SMB = "ftp", "sftp", "smb"
KINDS = (FTP, SFTP, SMB)
DEFAULT_PORT = {FTP: 21, SFTP: 22, SMB: 445}
#: Connection timeout, seconds: a server that is off must not hold a request.
TIMEOUT = 5.0

_lock = threading.Lock()
_cache: dict[str, tuple[tuple, Any]] = {}


def root(s: dict[str, Any]) -> str:
    """The storage's top folder, as its filesystem names it."""
    path = "/" + str(s.get("path", "")).strip("/")
    if s["kind"] == SMB:
        return posixpath.join(f"/{s['share']}", path.lstrip("/")).rstrip("/") or "/"
    return path


def _open(s: dict[str, Any], secret: str | None = None) -> Any:
    secret = (
        secret if secret is not None else vault.get(s["id"]).get("password") or None
    )
    host, port, user = (
        s["host"],
        int(s.get("port") or DEFAULT_PORT[s["kind"]]),
        s.get("username") or None,
    )
    if s["kind"] == FTP:
        return fsspec.filesystem(
            "ftp", host=host, port=port, username=user or "anonymous",
            password=secret or "", tls=bool(s.get("tls")), timeout=TIMEOUT,
            skip_instance_cache=True,
        )  # fmt: skip
    if s["kind"] == SFTP:
        return fsspec.filesystem(
            "sftp", host=host, port=port, username=user, password=secret,
            timeout=TIMEOUT, skip_instance_cache=True,
        )  # fmt: skip
    if user in (None, "guest") and not secret:
        # A guest share (a Freebox's): the session is opened here, as smbprotocol
        # refuses a guest one with its default checks, and fsspec reuses it.
        guest_session(host, port, s.get("share") or "")
        return fsspec.filesystem(
            "smb", host=host, port=port, username="guest", password="",
            timeout=TIMEOUT, skip_instance_cache=True, register_session_retries=-1,
        )  # fmt: skip
    return fsspec.filesystem(
        "smb", host=host, port=port, username=user, password=secret,
        timeout=TIMEOUT, skip_instance_cache=True,
    )  # fmt: skip


def guest_session(host: str, port: int, share: str) -> None:
    """An SMB session as "guest" with *host*, kept by smbclient for what follows.

    A guest session has no key to sign with, so signing is not asked for, and the
    check of the negotiation (which needs that key) is turned off while the session
    and its share's connection are made: smbclient keeps and reuses both, and the
    setting is global, so it is put back at once.
    """
    import smbclient

    config = smbclient.ClientConfig()
    before = config.require_secure_negotiate
    with _lock:
        config.require_secure_negotiate = False
        try:
            smbclient.register_session(
                host, username="guest", password="", port=port, require_signing=False,
                auth_protocol="ntlm", connection_timeout=TIMEOUT,
            )  # fmt: skip
            if share:
                smbclient.listdir(rf"\\{host}\{share}", port=port)  # connects the share
        finally:
            config.require_secure_negotiate = before


def filesystem(s: dict[str, Any]) -> Any:
    """The storage's filesystem, opened once and kept while its settings hold."""
    key = (s["kind"], s["host"], s.get("port"), s.get("username"), s.get("share"),
           s.get("tls"), vault.get(s["id"]).get("password"))  # fmt: skip
    with _lock:
        hit = _cache.get(s["id"])
        if hit and hit[0] == key:
            return hit[1]
    fs = _open(s)
    with _lock:
        _cache[s["id"]] = (key, fs)
    return fs


def forget(storage_id: str) -> None:
    with _lock:
        _cache.pop(storage_id, None)


def check(s: dict[str, Any]) -> dict[str, Any]:
    """Connect and list the top folder: what the add form says before adding."""
    fs = filesystem(s)
    entries = fs.ls(root(s), detail=True)
    return {"folders": sum(1 for e in entries if e.get("type") == "directory")}


def check_with(s: dict[str, Any], password: str) -> dict[str, Any]:
    """``check`` for a server not added yet: its password is not in the vault."""
    fs = _open(s, password or None)
    entries = fs.ls(root(s), detail=True)
    return {"folders": sum(1 for e in entries if e.get("type") == "directory")}


# --- a file on a server, as the media code sees it ------------------------------

#: This server's own address for the relay (``/api/storages/{id}/raw/...``), set
#: when it starts serving: ffmpeg reads a remote file there (spec §9.1).
RELAY = "http://127.0.0.1:8080"


def _mtime(info: dict[str, Any]) -> float:
    """A listing entry's modification time: each protocol words it its own way."""
    for key in ("mtime", "modified", "LastModified"):
        value = info.get(key)
        if isinstance(value, (int, float)):
            return float(value)
        if hasattr(value, "timestamp"):
            return float(value.timestamp())
    modify = str(info.get("modify") or "")  # FTP's MLSD: YYYYMMDDHHMMSS
    if len(modify) >= 14 and modify[:14].isdigit():
        import calendar
        import time

        return float(calendar.timegm(time.strptime(modify[:14], "%Y%m%d%H%M%S")))
    return 0.0


class _Stat:
    def __init__(self, size: int, mtime: float) -> None:
        self.st_size, self.st_mtime = size, mtime


class RemoteFile(PurePosixPath):
    """A path on an FTP, SFTP or SMB storage (spec §9.1).

    A pure POSIX path, so name, stem, suffix, parent and relative_to work as on a
    local file; ``stat``, ``iterdir`` and the rest ask the server (or answer from
    the listing entry it came with). ffmpeg reads ``url``: the relay on this
    server. ``str()`` stays the path, so comparing and hashing stay paths.
    """

    def __init__(self, *args: Any, storage: dict[str, Any] | None = None,
                 info: dict[str, Any] | None = None) -> None:  # fmt: skip
        super().__init__(*args)
        self.storage = storage or {}
        self._info = info

    def with_segments(self, *segments: Any) -> RemoteFile:
        return type(self)(*segments, storage=self.storage)

    @property
    def fs(self) -> Any:
        return filesystem(self.storage)

    def _entry(self) -> dict[str, Any]:
        if self._info is None:
            self._info = self.fs.info(str(self))
        return self._info

    def stat(self) -> _Stat:
        info = self._entry()
        return _Stat(int(info.get("size") or 0), _mtime(info))

    def exists(self) -> bool:
        try:
            self._entry()
            return True
        except (OSError, FileNotFoundError):
            return False

    def is_dir(self) -> bool:
        return self.exists() and self._entry().get("type") == "directory"

    def is_file(self) -> bool:
        return self.exists() and self._entry().get("type") != "directory"

    def is_symlink(self) -> bool:
        return False

    def iterdir(self) -> Any:
        for entry in self.fs.ls(str(self), detail=True):
            yield type(self)(entry["name"], storage=self.storage, info=entry)

    def glob(self, pattern: str) -> Any:  # type: ignore[override]
        """The entries of this folder whose name matches *pattern* (one level only:
        what sidecar subtitles need)."""
        import fnmatch

        for child in self.iterdir():
            if fnmatch.fnmatchcase(child.name, pattern):
                yield child

    def read_bytes(self) -> bytes:
        with self.open("rb") as handle:
            return handle.read()

    def relative(self) -> str:
        """Where it sits inside its storage, POSIX: the listing's ``rel``."""
        return self.relative_to(root(self.storage)).as_posix()

    @property
    def url(self) -> str:
        return f"{RELAY}/api/storages/{quote(self.storage['id'])}/raw/{quote(self.relative())}"

    def open(self, mode: str = "rb", **kw: Any) -> Any:  # type: ignore[override]
        return self.fs.open(str(self), mode, **kw)

    def unlink(self, missing_ok: bool = False) -> None:
        try:
            self.fs.rm(str(self))
        except FileNotFoundError:
            if not missing_ok:
                raise


def top(s: dict[str, Any]) -> RemoteFile:
    """A storage's top folder, to scan from."""
    return RemoteFile(root(s), storage=s)


def media_input(file: Any) -> str:
    """What ffmpeg is given for a stored file: its relay URL when it is on a server."""
    return getattr(file, "url", None) or str(file)


class ServerFile(RemoteFile):
    """A film on another sestudio (spec §9, X3): known from that server's listing
    and read through this one's relay, which asks it with the share token. Read
    only: nothing here deletes another server's files."""

    def stat(self) -> _Stat:
        info = self._info or {}
        return _Stat(int(info.get("size") or 0), float(info.get("mtime") or 0))

    def exists(self) -> bool:
        return self._info is not None

    def is_dir(self) -> bool:
        return False

    def is_file(self) -> bool:
        return self._info is not None

    def iterdir(self) -> Any:
        return iter(())

    def glob(self, pattern: str) -> Any:  # type: ignore[override]
        return iter(())  # sidecars stay on that server; embedded tracks still play

    def relative(self) -> str:
        return self.as_posix().lstrip("/")

    def open(self, mode: str = "rb", **kw: Any) -> Any:  # type: ignore[override]
        raise PermissionError("Read through the relay, not opened here")

    def unlink(self, missing_ok: bool = False) -> None:
        raise PermissionError("Files on another sestudio are read only here")


class BridgedFile(PurePosixPath):
    """A file of a share opened through a bridge (SPEC-storage §10, B12, B13): read,
    written, renamed and deleted by asking the bridge, which holds the share. The
    path is where it sits inside the share; what the copy engine needs, no more."""

    def __init__(self, *args: Any, storage: dict[str, Any] | None = None) -> None:
        super().__init__(*args)
        self.storage = storage or {}

    def with_segments(self, *segments: Any) -> BridgedFile:
        return type(self)(*segments, storage=self.storage)

    def relative(self) -> str:
        return self.as_posix().lstrip("/")

    def _key(self) -> str:
        from sestudio import storage

        return storage.remote_key(self.storage, self.relative())

    def _peer(self) -> tuple[str, dict[str, str]]:
        from sestudio import storage

        peer = storage.peer_of(self.storage)
        return peer["url"], storage._bearer(peer)

    def _call(self, method: str, route: str, **kw: Any) -> Any:
        import httpx

        url, headers = self._peer()
        with httpx.Client(timeout=60.0) as client:
            r = client.request(
                method, f"{url}/api/share/bridge{route}", headers=headers, **kw
            )
        if r.status_code >= 400:
            raise OSError(f"The bridge refused: {r.status_code} {r.text[:200]}")
        return r.json()

    def stat(self) -> _Stat:
        got = self._call("GET", "/stat", params={"path": self._key()})
        if not got.get("exists"):
            raise FileNotFoundError(self.relative())
        return _Stat(int(got.get("size") or 0), float(got.get("mtime") or 0))

    def exists(self) -> bool:
        try:
            self.stat()
            return True
        except FileNotFoundError:
            return False

    def is_file(self) -> bool:
        return self.exists()

    def glob(self, pattern: str) -> Any:  # type: ignore[override]
        return iter(())  # sidecars are not listed through a bridge

    def iterdir(self) -> Any:
        return iter(())

    def unlink(self, missing_ok: bool = False) -> None:
        if not missing_ok and not self.exists():
            raise FileNotFoundError(self.relative())
        self._call("DELETE", "/file", params={"path": self._key()})

    def rename_to(self, target: BridgedFile) -> None:
        self._call(
            "POST", "/move", json={"source": self._key(), "target": target._key()}
        )

    def open(self, mode: str = "rb", **kw: Any) -> Any:  # type: ignore[override]
        url, headers = self._peer()
        if mode == "rb":
            return _BridgeReader(f"{url}/api/share/video/file", self._key(), headers)
        if mode == "wb":
            return _BridgeWriter(f"{url}/api/share/bridge/file", self._key(), headers)
        raise ValueError(f"mode {mode!r}")


class _BridgeReader:
    """A file read from a bridge as one streamed answer."""

    def __init__(self, url: str, key: str, headers: dict[str, str]) -> None:
        import httpx

        self._client = httpx.Client(timeout=httpx.Timeout(30.0, read=None))
        self._response = self._client.send(
            self._client.build_request(
                "GET", url, params={"path": key}, headers=headers
            ),
            stream=True,
        )
        if self._response.status_code >= 400:
            self.close()
            raise OSError(
                f"The bridge did not give the file ({self._response.status_code})"
            )
        self._chunks = self._response.iter_raw()
        self._buffer = b""

    def read(self, size: int = -1) -> bytes:
        while size < 0 or len(self._buffer) < size:
            chunk = next(self._chunks, None)
            if chunk is None:
                break
            self._buffer += chunk
        if size < 0:
            out, self._buffer = self._buffer, b""
        else:
            out, self._buffer = self._buffer[:size], self._buffer[size:]
        return out

    def close(self) -> None:
        self._response.close()
        self._client.close()

    def __enter__(self) -> _BridgeReader:
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()


class _BridgeWriter:
    """A file written to a bridge as one streamed upload: what ``write`` is given
    goes out as it comes, and ``close`` waits for the bridge to have it all."""

    def __init__(self, url: str, key: str, headers: dict[str, str]) -> None:
        import queue
        import threading

        import httpx

        self._queue: queue.Queue[bytes | None] = queue.Queue(maxsize=8)
        self._error: BaseException | None = None

        def body() -> Any:
            while (chunk := self._queue.get()) is not None:
                yield chunk

        def send() -> None:
            try:
                with httpx.Client(
                    timeout=httpx.Timeout(30.0, read=None, write=None)
                ) as client:
                    r = client.put(
                        url, params={"path": key}, headers=headers, content=body()
                    )
                if r.status_code >= 400:
                    raise OSError(f"The bridge did not take the file ({r.status_code})")
            except BaseException as exc:  # noqa: BLE001 - reported by close()
                self._error = exc
                while self._queue.get() is not None:  # let write() and close() go on
                    pass

        self._thread = threading.Thread(target=send, daemon=True, name="bridge-write")
        self._thread.start()

    def write(self, data: bytes) -> int:
        if self._error:
            raise OSError(str(self._error))
        self._queue.put(bytes(data))
        return len(data)

    def close(self) -> None:
        if self._thread.is_alive():
            self._queue.put(None)
            self._thread.join()
        if self._error:
            raise OSError(str(self._error))

    def __enter__(self) -> _BridgeWriter:
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()
