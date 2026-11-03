"""Music playlists: the folder / playlist / set / smart-list tree (SPEC-music §13.2)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from sestudio import downloaded
from sestudio.config import load_config
from sestudio.music import online, playlists, queue
from sestudio.web.routes.music_queue import TrackRef, _check_tracks, _online_item

router = APIRouter(prefix="/music/playlists")


class CreateBody(BaseModel):
    kind: str
    name: str
    parent: str | None = None
    rules: dict[str, Any] | None = None


class UpdateBody(BaseModel):
    name: str | None = None
    rules: dict[str, Any] | None = None


class MoveBody(BaseModel):
    parent: str | None = None
    index: int | None = None


class ItemsBody(BaseModel):
    tracks: list[TrackRef]
    part: str | None = None
    index: int | None = None


class ItemMoveBody(BaseModel):
    item_id: str
    index: int
    part: str | None = None


class PartBody(BaseModel):
    name: str | None = None
    index: int | None = None


class PlayBody(BaseModel):
    part: str | None = None


def _run(fn: Any, *args: Any, **kw: Any) -> Any:
    try:
        return fn(*args, **kw)
    except playlists.Invalid as exc:
        raise HTTPException(400, str(exc)) from None


def _refs(tracks: list[TrackRef]) -> list[dict[str, Any]]:
    _check_tracks(
        [(t.library, t.track_id) for t in tracks if t.library != online.ONLINE_LIBRARY]
    )
    return [
        _online_item(t.model_dump(exclude_none=True))
        if t.library == online.ONLINE_LIBRARY
        else {"library": t.library, "track_id": t.track_id}
        for t in tracks
    ]


def _library_tracks() -> list[dict[str, Any]]:
    return [
        {"track_id": f.track_id, "mtime": f.mtime}
        for f in downloaded.scan(load_config().output_root)
        if f.kind == "audio"
    ]


@router.get("")
def list_nodes() -> list[dict[str, Any]]:
    return playlists.tree()


@router.post("")
def create_node(body: CreateBody) -> dict[str, Any]:
    return _run(playlists.create, body.kind, body.name, body.parent, body.rules)


@router.patch("/{node_id}")
def update_node(node_id: str, body: UpdateBody) -> dict[str, Any]:
    return _run(playlists.update, node_id, body.name, body.rules)


@router.post("/{node_id}/move")
def move_node(node_id: str, body: MoveBody) -> list[dict[str, Any]]:
    _run(playlists.move, node_id, body.parent, body.index)
    return playlists.tree()


@router.delete("/{node_id}")
def delete_node(node_id: str) -> dict[str, bool]:
    _run(playlists.delete, node_id)
    return {"ok": True}


@router.get("/{node_id}/tracks")
def smart_tracks(node_id: str) -> list[dict[str, str]]:
    """What a smart list holds right now."""
    node = _run(playlists.get, node_id)
    if node["kind"] != "smart":
        raise HTTPException(400, "not a smart list")
    return playlists.evaluate(node["rules"], _library_tracks())


@router.post("/{node_id}/items")
def add_items(node_id: str, body: ItemsBody) -> dict[str, Any]:
    return _run(playlists.add_items, node_id, _refs(body.tracks), body.part, body.index)


@router.delete("/{node_id}/items/{item_id}")
def remove_item(node_id: str, item_id: str) -> dict[str, Any]:
    return _run(playlists.remove_item, node_id, item_id)


@router.post("/{node_id}/items/move")
def move_item(node_id: str, body: ItemMoveBody) -> dict[str, Any]:
    return _run(playlists.move_item, node_id, body.item_id, body.index, body.part)


@router.post("/{node_id}/parts")
def add_part(node_id: str, body: PartBody) -> dict[str, Any]:
    return _run(playlists.add_part, node_id, body.name or "")


@router.patch("/{node_id}/parts/{part_id}")
def update_part(node_id: str, part_id: str, body: PartBody) -> dict[str, Any]:
    return _run(playlists.update_part, node_id, part_id, body.name, body.index)


@router.delete("/{node_id}/parts/{part_id}")
def delete_part(node_id: str, part_id: str) -> dict[str, Any]:
    return _run(playlists.delete_part, node_id, part_id)


@router.post("/{node_id}/play")
def play(node_id: str, body: PlayBody) -> dict[str, Any]:
    """Replace the queue with a playlist (or one of its parts), in order."""
    node = _run(playlists.get, node_id)
    if node["kind"] == "smart":
        refs = playlists.evaluate(node["rules"], _library_tracks())
    elif node["kind"] == "playlist":
        refs = [
            {k: v for k, v in i.items() if k != "item_id"}
            for i in _run(playlists.flat_items, node, body.part)
        ]
    else:
        raise HTTPException(400, "a folder cannot be played")
    known = {t["track_id"] for t in _library_tracks()}
    refs = [
        r
        for r in refs
        if r["library"] == online.ONLINE_LIBRARY or r["track_id"] in known
    ]
    if not refs:
        raise HTTPException(400, "nothing to play")
    return queue.add(refs, replace=True)
