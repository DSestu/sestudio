"""Storage and library-wide normalisation of track analyses.

Rows hold raw measurements; the 98th percentile per band and the brightness
ranking (for the hue) are derived from all of them and kept in ``music_state``,
so renormalising reads the table but never decodes audio again.
"""

from __future__ import annotations

import json
import time
from typing import Any

import numpy as np

from sestudio import library
from sestudio.music import profile
from sestudio.music.analysis import RawAnalysis

#: Renormalise when the analysed set has grown by more than this since the last time.
GROWTH = 0.10

#: What v2 adds to a track's analysis response (the raw chroma stays server-side).
V2_FIELDS = (
    "key",
    "camelot",
    "keyConf",
    "energy",
    "structure",
    "genre",
    "genreConf",
    "genreSource",
)


#: A genre the user confirmed or fixed; wins over the detected one everywhere.
OVERRIDE = "genre_override"


def set_genre(track_id: str, genre: str | None) -> bool:
    """Store (or with None, clear) the user's genre for an analysed track; False when it has no analysis."""
    with library._lock:
        conn = library._connect()
        row = conn.execute(
            "SELECT extra FROM music_analysis WHERE track_id = ?", (track_id,)
        ).fetchone()
        if row is None:
            return False
        extra = json.loads(row["extra"])
        if genre:
            extra[OVERRIDE] = genre
        else:
            extra.pop(OVERRIDE, None)
        conn.execute(
            "UPDATE music_analysis SET extra = ? WHERE track_id = ?",
            (json.dumps(extra), track_id),
        )
        conn.commit()
    return True


def save(track_id: str, mtime: float, size: int, a: RawAnalysis) -> None:
    with library._lock:
        conn = library._connect()
        conn.execute(
            "INSERT OR REPLACE INTO music_analysis (track_id, mtime, size, analysed_at,"
            " duration, zcr, bpm, beat0, bar0, bpm_conf, n, bands, loudness, extra)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                track_id, mtime, size, int(time.time()), a.duration, a.zcr, a.bpm,
                a.beat0, a.bar0, a.bpm_conf, a.bands.shape[1],
                a.bands.astype(np.float16).tobytes(),
                a.loudness.astype(np.float16).tobytes(), json.dumps(a.extra),
            ),
        )  # fmt: skip
        conn.commit()


def pending_v2() -> list[str]:
    """Ids of tracks analysed before the current v2 profile (or without one)."""
    with library._lock:
        rows = library._connect().execute("SELECT track_id, extra FROM music_analysis")
        return [
            r["track_id"]
            for r in rows
            if json.loads(r["extra"]).get("v2") != profile.VERSION
        ]


def pending_genre(model: bool) -> dict[str, tuple[dict[str, Any], float]]:
    """(profile, duration) of the tracks whose genre was not decided yet, by
    id: those at an older version, and, once the *model* may run, those
    decided without it."""
    from sestudio.music import genres

    with library._lock:
        rows = library._connect().execute(
            "SELECT track_id, duration, extra FROM music_analysis"
        )
        found = {r["track_id"]: (json.loads(r["extra"]), r["duration"]) for r in rows}
    return {
        t: (e, d)
        for t, (e, d) in found.items()
        if e.get("v2") == profile.VERSION
        and e.get("genreV") != genres.VERSION
        and (model or e.get("genreV") is None)
    }


def load_raw(track_id: str) -> RawAnalysis | None:
    with library._lock:
        r = (
            library._connect()
            .execute("SELECT * FROM music_analysis WHERE track_id = ?", (track_id,))
            .fetchone()
        )
    if r is None:
        return None
    bands = np.frombuffer(r["bands"], dtype=np.float16).reshape(8, r["n"])
    return RawAnalysis(
        r["duration"], bands.astype(np.float32),
        np.frombuffer(r["loudness"], dtype=np.float16).astype(np.float32),
        r["zcr"], r["bpm"], r["beat0"], r["bar0"], r["bpm_conf"],
    )  # fmt: skip


def set_extra(track_id: str, extra: dict[str, Any]) -> None:
    """Replace a track's profile; the user's genre choice survives a re-profile."""
    with library._lock:
        conn = library._connect()
        row = conn.execute(
            "SELECT extra FROM music_analysis WHERE track_id = ?", (track_id,)
        ).fetchone()
        if row and (g := json.loads(row["extra"]).get(OVERRIDE)):
            extra = {**extra, OVERRIDE: g}
        conn.execute(
            "UPDATE music_analysis SET extra = ? WHERE track_id = ?",
            (json.dumps(extra), track_id),
        )
        conn.commit()


def stamps() -> dict[str, tuple[float, int]]:
    """(mtime, size) of every analysed track, to tell which files changed."""
    with library._lock:
        rows = library._connect().execute(
            "SELECT track_id, mtime, size FROM music_analysis"
        )
        return {r["track_id"]: (r["mtime"], r["size"]) for r in rows}


def count() -> int:
    with library._lock:
        return (
            library._connect()
            .execute("SELECT COUNT(*) FROM music_analysis")
            .fetchone()[0]
        )


def _get_state() -> dict[str, Any] | None:
    with library._lock:
        row = (
            library._connect()
            .execute("SELECT value FROM music_state WHERE key = 'norm'")
            .fetchone()
        )
    return json.loads(row["value"]) if row else None


def renormalise() -> dict[str, Any]:
    """Recompute the per-band 98th percentile and the sorted brightness list."""
    with library._lock:
        rows = (
            library._connect()
            .execute("SELECT zcr, n, bands FROM music_analysis")
            .fetchall()
        )
    shaped = [
        np.frombuffer(r["bands"], dtype=np.float16).reshape(8, r["n"]) for r in rows
    ]
    norm = []
    for i in range(8):
        if not shaped:
            norm.append(1.0)
            continue
        allv = np.sort(np.concatenate([b[i] for b in shaped]).astype(np.float32))
        norm.append(float(allv[int(len(allv) * 0.98)]) or 1.0)
    state = {
        "norm": norm,
        "zcr": sorted(r["zcr"] for r in rows),
        "n": len(rows),
    }
    with library._lock:
        conn = library._connect()
        conn.execute(
            "INSERT OR REPLACE INTO music_state (key, value) VALUES ('norm', ?)",
            (json.dumps(state),),
        )
        conn.commit()
    return state


def renormalise_if_needed() -> bool:
    state = _get_state()
    if state is not None and count() <= state["n"] * (1 + GROWTH):
        return False
    renormalise()
    return True


def _percent(values: np.ndarray, norm: float) -> list[int]:
    return np.rint(np.minimum(values / norm, 1) * 100).astype(int).tolist()


def get(ids: list[str]) -> dict[str, dict[str, Any]]:
    """Normalised analyses of the tracks that have one, keyed by track id.

    Band and loudness values are whole percents (0..100): compact, and as fine as
    the prototype's two decimals.
    """
    if not ids:
        return {}
    state = _get_state() or renormalise()
    norm, zcr = state["norm"], np.asarray(state["zcr"])
    marks = ",".join("?" * len(ids))
    with library._lock:
        rows = (
            library._connect()
            .execute(f"SELECT * FROM music_analysis WHERE track_id IN ({marks})", ids)
            .fetchall()
        )
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        bands = np.frombuffer(r["bands"], dtype=np.float16).reshape(8, r["n"])
        bands = bands.astype(np.float32)
        loud = np.frombuffer(r["loudness"], dtype=np.float16).astype(np.float32)
        p = np.searchsorted(zcr, r["zcr"]) / (len(zcr) - 1) if len(zcr) > 1 else 0.5
        extra = json.loads(r["extra"])
        mean = [float(np.mean(np.minimum(bands[i] / norm[i], 1))) for i in range(8)]
        loud_norm = float(np.sort(loud)[int(len(loud) * 0.98)]) if len(loud) else 1.0
        out[r["track_id"]] = {
            "id": r["track_id"],
            "duration": round(r["duration"], 2),
            "bpm": r["bpm"],
            "beat0": r["beat0"],
            "bar0": r["bar0"],
            "bpmConf": r["bpm_conf"],
            "hue": round(195 + float(p) * 125),
            "bands": [_percent(bands[i], norm[i]) for i in range(8)],
            "loudness": _percent(loud, loud_norm or 1.0),
            # Mean bass, mids, highs (SPEC-music-player §6.1), 0..1.
            **{k: v for k, v in extra.items() if k in V2_FIELDS},
            **(
                {"genre": extra[OVERRIDE], "genreConf": 1.0, "genreSource": "user"}
                if extra.get(OVERRIDE)
                else {}
            ),
            "balance": [
                round(sum(mean[0:2]) / 2, 3),
                round(sum(mean[2:5]) / 3, 3),
                round(sum(mean[5:8]) / 3, 3),
            ],
        }
    return out
