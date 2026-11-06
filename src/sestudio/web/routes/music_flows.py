"""Flows and mixes (SPEC-music-flows §12 PR 1–2): documents, and rendering them over the library."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from sestudio import downloaded
from sestudio.music import libraries, mixes, store

router = APIRouter(prefix="/music")


class FlowBody(BaseModel):
    name: str | None = None
    flow: dict[str, Any] | None = None


class RenderBody(BaseModel):
    choices: dict[str, str] | None = None
    minutes: float | None = None
    seed: int = 1
    pins: dict[str, str] | None = None


class MixBody(BaseModel):
    name: str | None = None
    flow: str | None = None
    choices: dict[str, str] | None = None
    minutes: float | None = None
    seed: int | None = None
    pins: dict[str, str] | None = None
    tracks: list[str] | None = None


class ReadBody(BaseModel):
    name: str


def _run(fn: Any, *args: Any, **kw: Any) -> Any:
    try:
        return fn(*args, **kw)
    except mixes.Invalid as exc:
        raise HTTPException(400, str(exc)) from None


def _pool() -> list[dict[str, Any]]:
    """Every analysed track of the folder libraries: what the generator draws from (§6)."""
    ids = [
        f.track_id
        for _lib, root in libraries.folder_roots()
        for f in downloaded.audio_files(root, _lib)
    ]
    return list(store.get(ids).values())


@router.get("/flows")
def list_flows() -> list[dict[str, Any]]:
    return mixes.flows_list()


@router.post("/flows")
def create_flow(body: FlowBody) -> dict[str, Any]:
    return _run(mixes.flow_create, body.name or "Flow", body.flow or {})


@router.get("/flows/{flow_id}")
def get_flow(flow_id: str) -> dict[str, Any]:
    return _run(mixes.flow_get, flow_id)


@router.patch("/flows/{flow_id}")
def update_flow(flow_id: str, body: FlowBody) -> dict[str, Any]:
    return _run(mixes.flow_update, flow_id, body.name, body.flow)


@router.delete("/flows/{flow_id}")
def delete_flow(flow_id: str) -> dict[str, bool]:
    _run(mixes.flow_delete, flow_id)
    return {"ok": True}


@router.post("/flows/{flow_id}/render")
def render_flow(flow_id: str, body: RenderBody) -> dict[str, Any]:
    flow = _run(mixes.flow_get, flow_id)
    return mixes.render_flow(
        flow, _pool(), body.choices, body.minutes, body.seed, body.pins
    )


@router.post("/flows/render")
def render_draft(body: FlowBody) -> dict[str, Any]:
    """A flow that is not saved yet (the editor while it is being drawn)."""
    return mixes.render_flow(_run(mixes.clean_flow, body.flow or {}), _pool())


@router.get("/mixes")
def list_mixes() -> list[dict[str, Any]]:
    return mixes.mixes_list()


@router.post("/mixes")
def create_mix(body: MixBody) -> dict[str, Any]:
    return _run(
        mixes.mix_create,
        body.name or "Mix",
        body.flow,
        body.choices,
        body.minutes,
        body.seed or 1,
        body.pins,
        body.tracks,
    )


@router.get("/mixes/{mix_id}")
def get_mix(mix_id: str) -> dict[str, Any]:
    return _run(mixes.mix_get, mix_id)


@router.patch("/mixes/{mix_id}")
def update_mix(mix_id: str, body: MixBody) -> dict[str, Any]:
    fields = {
        k: v for k, v in body.model_dump().items() if v is not None and k != "tracks"
    }
    return _run(mixes.mix_update, mix_id, **fields)


@router.delete("/mixes/{mix_id}")
def delete_mix(mix_id: str) -> dict[str, bool]:
    _run(mixes.mix_delete, mix_id)
    return {"ok": True}


@router.post("/mixes/{mix_id}/render")
def render_mix(mix_id: str) -> dict[str, Any]:
    return _run(mixes.render_mix, _run(mixes.mix_get, mix_id), _pool())


@router.post("/mixes/{mix_id}/freeze")
def freeze_mix(mix_id: str) -> dict[str, Any]:
    """Snapshot the live mix's tracks; the flow may change, this mix will not (§7)."""
    mix = _run(mixes.mix_get, mix_id)
    if mix.get("frozen") is not None:
        return mix
    rendered = mixes.render_mix(mix, _pool())
    return mixes.mix_update(mix_id, frozen=[m["track_id"] for m in rendered["mix"]])


@router.post("/mixes/{mix_id}/thaw")
def thaw_mix(mix_id: str) -> dict[str, Any]:
    mix = _run(mixes.mix_get, mix_id)
    if not mix.get("flow"):
        raise HTTPException(400, "this mix has no flow yet: read one from it first")
    return mixes.mix_update(mix_id, frozen=None)


@router.post("/mixes/{mix_id}/read")
def read_mix(mix_id: str, body: ReadBody) -> dict[str, Any]:
    """Give a hand list a flow inferred from its tracks, every track pinned (§7)."""
    return _run(mixes.read_as_flow, mix_id, body.name, _pool())
