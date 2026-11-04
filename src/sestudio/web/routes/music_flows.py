"""Mix-builder flows: drafts and branches, kept server-side."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from sestudio.music import flows
from sestudio.web.routes.music_playlists import _refs, _run
from sestudio.web.routes.music_queue import TrackRef

router = APIRouter(prefix="/music/flows")


class FlowBody(BaseModel):
    name: str
    mode: str = "mix"
    fork: TrackRef | None = None
    base: str | None = None
    items: list[TrackRef] = []


class PatchBody(BaseModel):
    name: str | None = None
    fork: TrackRef | None = None
    base: str | None = None
    items: list[TrackRef] | None = None


class SetBody(BaseModel):
    name: str | None = None
    parent: str | None = None


def _fork(ref: TrackRef | None) -> dict[str, Any] | None:
    return _refs([ref])[0] if ref else None


@router.get("")
def list_flows() -> list[dict[str, Any]]:
    return flows.list_all()


@router.post("")
def create_flow(body: FlowBody) -> dict[str, Any]:
    return _run(
        flows.create,
        body.name,
        body.mode,
        _fork(body.fork),
        body.base,
        _refs(body.items),
    )


@router.patch("/{flow_id}")
def update_flow(flow_id: str, body: PatchBody) -> dict[str, Any]:
    """Only the keys sent change; ``fork: null`` clears the fork, ``items`` replaces the list."""
    given = body.model_fields_set
    fields: dict[str, Any] = {}
    if body.name is not None:
        fields["name"] = body.name
    if "fork" in given:
        fields["fork"] = _fork(body.fork)
    if "base" in given:
        fields["base"] = body.base
    if body.items is not None:
        fields["items"] = _refs(body.items)
    return _run(flows.update, flow_id, **fields)


@router.delete("/{flow_id}")
def delete_flow(flow_id: str) -> dict[str, bool]:
    _run(flows.delete, flow_id)
    return {"ok": True}


@router.post("/{flow_id}/set")
def flow_to_set(flow_id: str, body: SetBody) -> dict[str, Any]:
    """Copy the flow into a new set (playlist); the flow stays."""
    return _run(flows.to_set, flow_id, body.name, body.parent)
