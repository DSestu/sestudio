"""Flows and mixes (SPEC-music-flows §12 PR 1–2): documents, and rendering them over the library."""

from __future__ import annotations

import time
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from sestudio import downloaded
from sestudio.music import flows, libraries, mixes, queue, store

router = APIRouter(prefix="/music")


class Source(BaseModel):
    """What a play may draw from (SPEC-flows-tab §2)."""

    kind: Literal["library", "artist", "album", "genre"]
    value: str
    rule: Literal["only", "lean"] = "only"


class Scoped(BaseModel):
    """The sources of a play, and what happens when its Only sources run out."""

    sources: list[Source] | None = None
    then: Literal["stop", "similar"] = "similar"

    def scope(self) -> dict[str, Any]:
        return {
            "sources": [s.model_dump() for s in self.sources or []],
            "then": self.then,
        }


class FlowBody(BaseModel):
    name: str | None = None
    flow: dict[str, Any] | None = None


class RenderBody(Scoped):
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
    """Every analysed track of the folder libraries: what the generator draws from (§6).

    Each carries its ``library`` so a rendered mix can go into the queue.
    """
    where = {
        f.track_id: (lib, f)
        for lib, root in libraries.folder_roots()
        for f in downloaded.audio_files(root, lib)
    }
    found = store.get(list(where))
    # Title, artist and album come from the file: sources filter on them, and a song in
    # two files is played once.
    return [
        {
            **a,
            "library": where[tid][0],
            "title": where[tid][1].title,
            "artist": where[tid][1].artist,
            "album": where[tid][1].album,
        }
        for tid, a in found.items()
    ]


FLOW_FIELDS = ("chunk", "join", "fit", "event", "blend", "lean", "pinned")


def _items(
    rendered: dict[str, Any], pool: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Queue items for a rendered mix, each with what its join did (§6)."""
    where = {t["id"]: t["library"] for t in pool}
    return [
        {
            "library": where[m["track_id"]],
            "track_id": m["track_id"],
            "flow": {k: m.get(k) for k in FLOW_FIELDS},
        }
        for m in rendered["mix"]
        if m["track_id"] in where
    ]


def _clock(at: float) -> float:
    """Minutes after local midnight at epoch seconds *at*."""
    t = datetime.fromtimestamp(at)
    return t.hour * 60 + t.minute + t.second / 60


def _context(started: float, skips: list[bool] | None = None) -> dict[str, Any]:
    """What a fork's conditions read (§5): the clock when the mix started, recent skips."""
    return {"clock": _clock(started), "skips": skips or []}


def _source(rendered: dict[str, Any], **ids: Any) -> dict[str, Any]:
    return {
        "started": time.time(),
        **ids,
        "path": rendered.get("path", []),
        "auto": rendered.get("auto", {}),
        "minutes": rendered.get("minutes"),
    }


def _queue_run(fn: Any, *args: Any, **kw: Any) -> Any:
    try:
        return fn(*args, **kw)
    except queue.Invalid as exc:
        raise HTTPException(400, str(exc)) from None


@router.get("/flows")
def list_flows() -> list[dict[str, Any]]:
    return mixes.flows_list()


@router.post("/flows")
def create_flow(body: FlowBody) -> dict[str, Any]:
    return _run(mixes.flow_create, body.name or "Flow", body.flow or {})


@router.get("/flows/sources")
def flow_sources() -> dict[str, list[dict[str, Any]]]:
    """What a play can draw from (SPEC-flows-tab §2): every genre, library, artist and album
    of the analysed tracks, with how many each holds, most first."""
    labels = {
        lib["id"]: lib.get("label") or lib["id"] for lib in libraries.all_libraries()
    }
    seen: dict[str, dict[str, dict[str, Any]]] = {k: {} for k in flows.SOURCE_KINDS}
    for t in _pool():
        for kind in flows.SOURCE_KINDS:
            value = str(t.get(kind) or "").strip()
            if not value:
                continue
            key = value.casefold()
            row = seen[kind].setdefault(
                key, {"value": value, "label": labels.get(value, value), "count": 0}
            )
            row["count"] += 1
            if kind == "album" and t.get("artist"):
                row.setdefault("sub", t["artist"])
    return {
        kind: sorted(rows.values(), key=lambda r: (-r["count"], r["label"].casefold()))
        for kind, rows in seen.items()
    }


class ScopeBody(BaseModel):
    sources: list[Source] = []


@router.post("/flows/scope")
def flow_scope(body: ScopeBody) -> dict[str, Any]:
    """How much music a set of sources holds: the tracks their Only rules keep, how many of
    those a Lean rule favours, and the seconds of mix they fill."""
    pool = _pool()
    scoped, lean, narrowed = flows.scope(pool, [s.model_dump() for s in body.sources])
    return {
        "count": len(scoped),
        "lean": sum(1 for t in scoped if t["id"] in lean),
        "seconds": round(flows.capacity(scoped)),
        "narrowed": narrowed,
    }


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
        flow, _pool(), body.choices, body.minutes, body.seed, body.pins, **body.scope()
    )


class DraftBody(Scoped):
    flow: dict[str, Any]
    choices: dict[str, str] | None = None
    minutes: float | None = None
    seed: int = 1


@router.post("/flows/render")
def render_draft(body: DraftBody) -> dict[str, Any]:
    """A flow that is not saved yet (the editor while it is being drawn), with its fork choices."""
    flow = _run(mixes.clean_flow, body.flow)
    return mixes.render_flow(
        flow,
        _pool(),
        body.choices,
        body.minutes,
        body.seed,
        context=_context(time.time()),
        **body.scope(),
    )


class FitsBody(BaseModel):
    layers: dict[str, Any]
    stretches: list[tuple[float, float]]


@router.post("/flows/fits")
def flow_fits(body: FitsBody) -> dict[str, Any]:
    """The lanes editor's library check: per stretch, how many tracks fit and a few of them; the genres there are."""
    pool = _pool()
    out = []
    for a, b in body.stretches:
        hit = flows.fits(body.layers, a, b, pool)
        out.append({"count": len(hit), "ids": [t["id"] for t in hit[:8]]})
    genres: dict[str, int] = {}
    for t in pool:
        if t.get("genre"):
            genres[t["genre"]] = genres.get(t["genre"], 0) + 1
    return {"stretches": out, "genres": genres}


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


class PlayBody(Scoped):
    choices: dict[str, str] | None = None
    minutes: float | None = None
    seed: int = 1


@router.post("/flows/{flow_id}/play")
def play_flow(flow_id: str, body: PlayBody) -> dict[str, Any]:
    """Render the flow and play it: the queue becomes this mix (§7)."""
    flow = _run(mixes.flow_get, flow_id)
    pool = _pool()
    rendered = mixes.render_flow(
        flow,
        pool,
        body.choices,
        body.minutes,
        body.seed,
        context=_context(time.time()),
        **body.scope(),
    )
    source = _source(
        rendered,
        flow=flow_id,
        mix=None,
        choices=body.choices or {},
        seed=body.seed,
        **body.scope(),
    )
    return _queue_run(queue.add, _items(rendered, pool), replace=True, source=source)


@router.post("/mixes/{mix_id}/play")
def play_mix(mix_id: str, body: Scoped | None = None) -> dict[str, Any]:
    mix = _run(mixes.mix_get, mix_id)
    pool = _pool()
    scope = (body or Scoped()).scope()
    rendered = _run(mixes.render_mix, mix, pool, **scope)
    source = _source(
        rendered,
        flow=mix.get("flow"),
        mix=mix_id,
        choices=mix.get("choices") or {},
        seed=mix.get("seed", 1),
        **scope,
    )
    if mix.get("frozen") is not None:
        source["frozen"] = True
    return _queue_run(queue.add, _items(rendered, pool), replace=True, source=source)


class RerouteBody(BaseModel):
    choices: dict[str, str] | None = None
    seed: int | None = None


@router.post("/queue/reroute")
def reroute(body: RerouteBody) -> dict[str, Any]:
    """Re-render what is still to come (a fork taken, a reroll, a flow edit): the played part stays (§5)."""
    state = queue.get_state()
    src = state.get("source")
    if not src or not src.get("flow"):
        raise HTTPException(400, "the queue does not play a flow")
    if src.get("frozen"):
        raise HTTPException(400, "the queue plays a frozen mix")
    flow = _run(mixes.flow_get, src["flow"])
    choices = {**(src.get("choices") or {}), **(body.choices or {})}
    seed = body.seed if body.seed is not None else src.get("seed", 1)
    played = state["items"][: state["current"] + 1]
    pins = {str(i): it["track_id"] for i, it in enumerate(played)}
    pool = _pool()
    started = src.get("started") or time.time()
    rendered = mixes.render_flow(
        flow,
        pool,
        choices,
        src.get("minutes"),
        seed,
        pins,
        context=_context(started, state.get("skips")),
        sources=src.get("sources"),
        then=src.get("then", "similar"),
    )
    items = _items(rendered, pool)[len(played) :]
    source = {
        **_source(
            rendered,
            flow=src["flow"],
            mix=src.get("mix"),
            choices=choices,
            seed=seed,
            sources=src.get("sources") or [],
            then=src.get("then", "similar"),
        ),
        "started": started,
    }
    return _queue_run(queue.future, items, source)


class ReadBody2(BaseModel):
    name: str = "Queue"


@router.post("/queue/read")
def read_queue(body: ReadBody2) -> dict[str, Any]:
    """Give a hand-made queue a flow read from its tracks, every track pinned; it then plays that mix (§7)."""
    state = queue.get_state()
    ids = [it["track_id"] for it in state["items"]]
    if not ids:
        raise HTTPException(400, "the queue is empty")
    mix = _run(mixes.mix_create, body.name, None, tracks=ids)
    pool = _pool()
    mix = _run(mixes.read_as_flow, mix["id"], body.name, pool)
    # Long enough for every pinned track: they all stay, now with what each join does.
    dur = {t["id"]: t.get("duration") or 240 for t in pool}
    minutes = sum(dur.get(t, 240) for t in ids) / 60 + 1
    rendered = mixes.render_flow(
        _run(mixes.flow_get, mix["flow"]), pool, {}, minutes, 1, mix["pins"]
    )
    source = _source(rendered, flow=mix["flow"], mix=mix["id"], choices={}, seed=1)
    keep = state["current"] + 1
    return _queue_run(queue.future, _items(rendered, pool)[keep : len(ids)], source)
