"""Passwords for storages (SPEC-storage §9, X4): ``secrets.json`` beside the config.

Kept out of ``config.json`` so the config can be copied around and shown without
them, readable only by the user on POSIX, and never sent to a client. Keyed by
storage id; a storage's secrets go when it does.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

from sestudio.config import config_dir

_lock = threading.Lock()
#: Secrets held in memory only: a share a bridge opened for another sestudio
#: (SPEC-storage §10) never reaches this machine's disk.
_memory: dict[str, dict[str, Any]] = {}


def _path() -> Path:
    return config_dir() / "secrets.json"


def _read() -> dict[str, dict[str, Any]]:
    try:
        data = json.loads(_path().read_text("utf-8"))
        return {k: v for k, v in data.items() if isinstance(v, dict)}
    except (OSError, ValueError, AttributeError):
        return {}


def _write(data: dict[str, dict[str, Any]]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    # Created owner-only, so the secret is never readable by others even briefly.
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    tmp.replace(path)


def get(storage_id: str) -> dict[str, Any]:
    with _lock:
        if storage_id in _memory:
            return dict(_memory[storage_id])
        return dict(_read().get(storage_id, {}))


def hold(storage_id: str, values: dict[str, Any]) -> None:
    """Keep *values* in memory only, until :func:`release` or the end of the process."""
    with _lock:
        _memory[storage_id] = dict(values)


def release(storage_id: str) -> None:
    with _lock:
        _memory.pop(storage_id, None)


def put(storage_id: str, values: dict[str, Any]) -> None:
    with _lock:
        data = _read()
        data[storage_id] = {**data.get(storage_id, {}), **values}
        _write(data)


def drop(storage_id: str) -> None:
    with _lock:
        data = _read()
        if data.pop(storage_id, None) is not None:
            _write(data)
