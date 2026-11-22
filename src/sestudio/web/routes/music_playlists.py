"""Music playlists: the folder / playlist / set / smart-list tree (SPEC-music §13.2)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from sestudio import downloaded
from sestudio.music import builder, flows, libraries, mixes, online, playlists, queue
from sestudio.web.routes.music import _set_tracks
from sestudio.web.routes.music_flows import _pool as _flows_pool
from sestudio.web.routes.music_queue import TrackRef, _check_tracks, _online_item

router = APIRouter(prefix="/music/playlists")


class CreateBody(BaseModel):
    kind: str
    name: str
    parent: str | None = None
    rules: dict[str, Any] | None = None


class BlendBy(BaseModel):
    """How a blend playlist re-orders after an edit: the Blend by weights and harmony
    moves of the Music page, and how many leading tracks are locked (the ones played)."""

    weights: dict[str, float] | None = None
    harmony: dict[str, float] | None = None
    start: int = Field(0, ge=0)


class UpdateBody(BlendBy):
    name: str | None = None
    rules: dict[str, Any] | None = None
    blend: bool | None = None
    shape: str | None = None


class MoveBody(BaseModel):
    parent: str | None = None
    index: int | None = None


class ItemsBody(BlendBy):
    tracks: list[TrackRef]
    part: str | None = None
    index: int | None = None


class ItemMoveBody(BlendBy):
    item_id: str
    index: int
    part: str | None = None


class ReorderBody(BlendBy):
    order: list[str]
    part: str | None = None
    whole: bool = False


class PartBody(BaseModel):
    name: str | None = None
    index: int | None = None


class PlayBody(BaseModel):
    part: str | None = None


class BlendBody(BlendBy):
    #: Ignore the stay-put cost once (Re-blend all).
    full: bool = False


class RestoreBody(BaseModel):
    items: list[dict[str, Any]]
    parts: list[dict[str, Any]] = []
    pins: dict[str, int] = {}
    blend: bool
    shape: str


class FillBody(BlendBy):
    flow: str
    minutes: float = Field(gt=0)
    #: Also take the flow's energy curve as the playlist's shape.
    use_shape: bool = True
    #: Only say which tracks would be added; save nothing (the preview of Fill).
    dry_run: bool = False


def _run(fn: Any, *args: Any, **kw: Any) -> Any:
    try:
        return fn(*args, **kw)
    except (playlists.Invalid, mixes.Invalid) as exc:
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
        {"library": lib_id, "track_id": f.track_id, "mtime": f.mtime}
        for lib_id, root in libraries.folder_roots()
        for f in downloaded.audio_files(root, lib_id)
    ]


def _shape(name: str) -> str | list[float]:
    """A shape name for the order engine; a flow's is its energy curve (Lift when the flow is gone)."""
    if name.startswith("flow:"):
        try:
            return flows.shape_curve(mixes.flow_get(name[5:])["chunks"])
        except mixes.Invalid:
            return "Lift"
    return name if name in builder.SHAPES else "Lift"


def _order(
    items: list[dict[str, Any]],
    pins: dict[str, int],
    shape: str | list[float],
    body: BlendBy,
    stay: bool,
    start: int,
) -> list[str]:
    """The item ids of one list in blend order; an item stands for its track under its own id."""
    tracks = [
        {**t, "id": i["item_id"]}
        for t, i in zip(_set_tracks([i["track_id"] for i in items]), items)
    ]
    here = {i["item_id"] for i in items}
    at = {iid: k for iid, k in pins.items() if iid in here and k < len(items)}
    out = builder.order_set(
        tracks,
        {k: iid for iid, k in at.items()},
        shape,
        body.weights,
        body.harmony,
        stay,
        start,
    )
    return [t["id"] for t in out]


def _reblend(node_id: str, body: BlendBy, full: bool = False) -> dict[str, Any]:
    """Re-order a playlist (each part on its own), save it, and say which rows moved."""
    node = _run(playlists.get, node_id)
    shape, done, order = _shape(node["shape"]), 0, []
    for items in playlists._buckets(node):
        order += _order(
            items, node["pins"], shape, body, not full, max(0, body.start - done)
        )
        done += len(items)
    before = [i["item_id"] for i in playlists.flat_items(node)]
    saved = _run(playlists.reorder, node_id, order, None, True, False)
    return {**saved, "moved": playlists.moved_ids(before, order)}


def _settled(node: dict[str, Any], body: BlendBy) -> dict[str, Any]:
    """The response of an item edit: a blend playlist re-orders at once (stay put), a hand one stays as it is."""
    return _reblend(node["id"], body) if node["blend"] else node


@router.get("")
def list_nodes() -> list[dict[str, Any]]:
    return playlists.tree()


@router.post("")
def create_node(body: CreateBody) -> dict[str, Any]:
    return _run(playlists.create, body.kind, body.name, body.parent, body.rules)


@router.patch("/{node_id}")
def update_node(node_id: str, body: UpdateBody) -> dict[str, Any]:
    was = _run(playlists.get, node_id)
    node = _run(
        playlists.update, node_id, body.name, body.rules, body.blend, body.shape
    )
    if not node.get("blend"):
        return node
    if not was.get("blend") or body.shape is not None:  # first Blend: a full re-order
        return _reblend(node_id, body, full=not was.get("blend"))
    return node


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
    node = _run(playlists.add_items, node_id, _refs(body.tracks), body.part, body.index)
    return _settled(node, body)


@router.delete("/{node_id}/items/{item_id}")
def remove_item(
    node_id: str, item_id: str, start: int = 0, body: BlendBy | None = None
) -> dict[str, Any]:
    """Remove an item; the optional body carries Blend by (a DELETE with a body)."""
    node = _run(playlists.remove_item, node_id, item_id)
    return _settled(node, body or BlendBy(start=start))


@router.post("/{node_id}/items/move")
def move_item(node_id: str, body: ItemMoveBody) -> dict[str, Any]:
    node = _run(playlists.move_item, node_id, body.item_id, body.index, body.part)
    return _settled(node, body)


@router.post("/{node_id}/items/reorder")
def reorder_items(node_id: str, body: ReorderBody) -> dict[str, Any]:
    node = _run(playlists.reorder, node_id, body.order, body.part, body.whole)
    return _settled(node, body)


@router.post("/{node_id}/blend")
def blend_node(node_id: str, body: BlendBody) -> dict[str, Any]:
    """Re-order the playlist by Blend, pins kept; stay-put unless *full*. Returns the node and ``moved``."""
    return _reblend(node_id, body, body.full)


@router.post("/{node_id}/restore")
def restore(node_id: str, body: RestoreBody) -> dict[str, Any]:
    """Undo: put the playlist back as an earlier response showed it, without re-ordering."""
    return _run(
        playlists.restore,
        node_id,
        body.items,
        body.parts,
        body.pins,
        body.blend,
        body.shape,
    )


def _free(node: dict[str, Any], pool: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The tracks of *pool* a fill could add: not in the playlist, nor another version of a song in it."""
    by_id = {t["id"]: t for t in pool}
    have = [
        by_id.get(i["track_id"]) or {**i, "id": i["track_id"]}
        for i in _run(playlists.flat_items, node)
    ]
    taken = {t["id"] for t in have}
    songs = {flows.song(t) for t in have}
    return [t for t in pool if t["id"] not in taken and flows.song(t) not in songs]


@router.get("/{node_id}/fill/fits")
def fill_fits(node_id: str) -> dict[str, int]:
    """How many tracks each flow could add to the playlist, for the Fill popover."""
    node = _run(playlists.get, node_id)
    free = _free(node, _flows_pool())
    # The tracks no Must keeps out of any of the flow's chunks: what it can draw on, without rendering.
    return {
        f["id"]: len(
            {
                t["id"]
                for c in f["chunks"]
                for t in flows.fits(c.get("layers") or {}, 0, 1, free)
            }
        )
        for f in mixes.flows_list()
    }


@router.post("/{node_id}/fill")
def fill(node_id: str, body: FillBody) -> dict[str, Any]:
    """Add about *minutes* of tracks that fit a flow (none already in the playlist), then re-order.

    Returns the node, ``added`` (new item ids) and ``moved`` (empty on a hand playlist);
    with ``dry_run`` only ``{candidates: [track_id]}``, nothing saved.
    """
    node = _run(playlists.get, node_id)
    flow = _run(mixes.flow_get, body.flow)
    pool = _flows_pool()
    free = _free(node, pool)
    rendered = _run(mixes.render_flow, flow, free, minutes=body.minutes)["mix"]
    if not rendered:
        raise HTTPException(400, "no track fits")
    by_pool = {t["id"]: t["library"] for t in pool}
    refs = [
        {"library": by_pool[m["track_id"]], "track_id": m["track_id"]} for m in rendered
    ]
    if body.dry_run:
        return {"candidates": [r["track_id"] for r in refs]}
    old = {i["item_id"] for i in playlists.flat_items(node)}
    node = _run(playlists.add_items, node_id, refs)
    if body.use_shape:
        node = _run(playlists.update, node_id, shape=f"flow:{body.flow}")
    out = _settled(node, body)
    added = [i["item_id"] for i in playlists.flat_items(out) if i["item_id"] not in old]
    return {"moved": [], **out, "added": added}


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


def migrate_mixes() -> int:
    """At startup: carry the old mixes over as blend playlists (once)."""
    return playlists.migrate_mixes(_flows_pool())
