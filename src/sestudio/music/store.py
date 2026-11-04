"""Storage and library-wide normalisation of track analyses.

Rows hold raw measurements; the 98th percentile per band and the brightness
ranking (for the hue) are derived from all of them and kept in ``music_state``,
so renormalising reads the table but never decodes audio again.
"""

from __future__ import annotations

import json
import threading
import time
from collections import Counter
from typing import Any

import numpy as np

from sestudio import library
from sestudio.music import genres, modes, profile
from sestudio.music.analysis import RawAnalysis

#: Renormalise when the analysed set has grown by more than this since the last time.
GROWTH = 0.10

#: What v2 adds to a track's analysis response.
V2_FIELDS = (
    "key",
    "camelot",
    "keyConf",
    "energy",
    "structure",
    "genre",
    "genreConf",
    "genreSource",
    "harmony",
)


#: A genre the user confirmed or fixed; wins over the detected one everywhere.
OVERRIDE = "genre_override"
#: The tonic and mode the user settled by ear ({"tonic", "mode"}); wins over the detected ones.
MODE_OVERRIDE = "mode_override"
#: The user's choices, which survive a re-analysis or a re-profile.
USER_KEYS = (OVERRIDE, MODE_OVERRIDE)


def _keep_user(old: Any, extra: dict[str, Any]) -> dict[str, Any]:
    """*extra* with the user's choices from the stored row *old* (None when there is none)."""
    kept = json.loads(old["extra"]) if old else {}
    return extra | {k: kept[k] for k in USER_KEYS if k in kept}


def _set_user(track_id: str, key: str, value: Any) -> bool:
    """Store (or with None, clear) one of the user's choices; False when the track has no analysis."""
    with library._lock:
        conn = library._connect()
        row = conn.execute(
            "SELECT extra FROM music_analysis WHERE track_id = ?", (track_id,)
        ).fetchone()
        if row is None:
            return False
        extra = json.loads(row["extra"])
        if value:
            extra[key] = value
        else:
            extra.pop(key, None)
        conn.execute(
            "UPDATE music_analysis SET extra = ? WHERE track_id = ?",
            (json.dumps(extra), track_id),
        )
        conn.commit()
    return True


def set_genre(track_id: str, genre: str | None) -> bool:
    """Store (or with None, clear) the user's genre for an analysed track; False when it has no analysis."""
    return _set_user(track_id, OVERRIDE, genre)


def set_mode(track_id: str, tonic: str | None, mode: str | None) -> bool:
    """Store the tonic and mode the user settled (both None clears it); False when not analysed."""
    choice = {"tonic": tonic, "mode": mode} if tonic and mode else None
    return _set_user(track_id, MODE_OVERRIDE, choice)


def save(track_id: str, mtime: float, size: int, a: RawAnalysis) -> None:
    """Store a fresh analysis; the user's genre and mode choices survive it."""
    with library._lock:
        conn = library._connect()
        row = conn.execute(
            "SELECT extra FROM music_analysis WHERE track_id = ?", (track_id,)
        ).fetchone()
        extra = _keep_user(row, a.extra)
        conn.execute(
            "INSERT OR REPLACE INTO music_analysis (track_id, mtime, size, analysed_at,"
            " duration, zcr, bpm, beat0, bar0, bpm_conf, n, bands, loudness, extra)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                track_id, mtime, size, int(time.time()), a.duration, a.zcr, a.bpm,
                a.beat0, a.bar0, a.bpm_conf, a.bands.shape[1],
                a.bands.astype(np.float16).tobytes(),
                a.loudness.astype(np.float16).tobytes(), json.dumps(extra),
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


def pending_modes() -> list[str]:
    """Ids of v2-profiled tracks whose tonic and mode were not read at the current version."""
    with library._lock:
        rows = library._connect().execute("SELECT track_id, extra FROM music_analysis")
        return [
            r["track_id"]
            for r in rows
            if (e := json.loads(r["extra"])).get("v2") == profile.VERSION
            and e.get("modesV") != modes.VERSION
        ]


def unsure() -> list[str]:
    """Ids of tracks whose detected mode is unsure and that the user has not settled."""
    with library._lock:
        rows = library._connect().execute(
            "SELECT track_id FROM music_analysis"
            " WHERE json_extract(extra, '$.harmony.track.unsure')"
            " AND json_extract(extra, '$.mode_override') IS NULL"
        )
        return [r["track_id"] for r in rows]


def merge_extra(track_id: str, fields: dict[str, Any]) -> None:
    """Add or replace some keys of a track's profile, keeping the rest."""
    with library._lock:
        conn = library._connect()
        row = conn.execute(
            "SELECT extra FROM music_analysis WHERE track_id = ?", (track_id,)
        ).fetchone()
        if row is None:
            return
        conn.execute(
            "UPDATE music_analysis SET extra = ? WHERE track_id = ?",
            (json.dumps(json.loads(row["extra"]) | fields), track_id),
        )
        conn.commit()


def pending_genre(model: bool) -> dict[str, tuple[dict[str, Any], float]]:
    """(profile, duration) of the tracks whose genre was not decided yet, by
    id: those at an older version, and, once the *model* may run, those
    decided without it."""
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
    """Replace a track's profile; the user's genre and mode choices survive a re-profile."""
    with library._lock:
        conn = library._connect()
        row = conn.execute(
            "SELECT extra FROM music_analysis WHERE track_id = ?", (track_id,)
        ).fetchone()
        extra = _keep_user(row, extra)
        conn.execute(
            "UPDATE music_analysis SET extra = ? WHERE track_id = ?",
            (json.dumps(extra), track_id),
        )
        conn.commit()


def forget(ids: list[str]) -> int:
    """Mark these tracks' analyses stale so the runner redoes them; they stay readable meanwhile."""
    with library._lock:
        conn = library._connect()
        n = conn.executemany(
            "UPDATE music_analysis SET mtime = -1 WHERE track_id = ?",
            [(i,) for i in ids],
        ).rowcount
        conn.commit()
    return n


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
    """Recompute the per-band 98th percentile, the sorted brightness list and the energy scale."""
    with library._lock:
        rows = (
            library._connect()
            .execute("SELECT zcr, n, bands, loudness FROM music_analysis")
            .fetchall()
        )
    shaped = [
        np.frombuffer(r["bands"], dtype=np.float16).reshape(8, r["n"]) for r in rows
    ]
    raws = [
        e["track"]
        for b, r in zip(shaped, rows)
        if "track" in (e := profile.energy_raw(b, _loudness(r)))
    ]
    loud, highs = sorted(v[0] for v in raws), sorted(v[1] for v in raws)
    scores = sorted(profile.energy_score(v, loud, highs) for v in raws)
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
        "energy": {"loud": loud, "highs": highs, "score": scores},
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


def _loudness(r: Any) -> np.ndarray:
    return np.frombuffer(r["loudness"], dtype=np.float16).astype(np.float32)


def _percent(values: np.ndarray, norm: float) -> list[int]:
    return np.rint(np.minimum(values / norm, 1) * 100).astype(int).tolist()


def get(ids: list[str]) -> dict[str, dict[str, Any]]:
    """Normalised analyses of the tracks that have one, keyed by track id.

    Band and loudness values are whole percents (0..100): compact, and as fine as
    the prototype's two decimals.
    """
    if not ids:
        return {}
    state = _get_state()
    if (
        state is None or "energy" not in state
    ):  # none yet, or from before the energy scale
        state = renormalise()
    norm, zcr = state["norm"], np.asarray(state["zcr"])
    marks = ",".join("?" * len(ids))
    with library._lock:
        rows = (
            library._connect()
            .execute(f"SELECT * FROM music_analysis WHERE track_id IN ({marks})", ids)
            .fetchall()
        )
    out: dict[str, dict[str, Any]] = {}
    spelling = _spellings()
    for r in rows:
        bands = np.frombuffer(r["bands"], dtype=np.float16).reshape(8, r["n"])
        loud = _loudness(r)
        energy = profile.energy_scale(profile.energy_raw(bands, loud), state["energy"])
        bands = bands.astype(np.float32)
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
            **(
                {"harmony": h}
                if (h := modes.served(extra.get("harmony"), extra.get(MODE_OVERRIDE)))
                else {}
            ),
            **energy,
            "balance": [
                round(sum(mean[0:2]) / 2, 3),
                round(sum(mean[2:5]) / 3, 3),
                round(sum(mean[5:8]) / 3, 3),
            ],
        }
        # Spellings of one genre ("synthpop", "Synth-Pop") show as one.
        if g := out[r["track_id"]].get("genre"):
            out[r["track_id"]]["genre"] = spelling.get(genres._key(g), genres.spell(g))
    return out


# --- analyses in progress -----------------------------------------------------

#: Track id -> (raw band envelopes so far, duration), while it is being analysed.
_partial: dict[str, tuple[np.ndarray, float]] = {}
_partial_lock = threading.Lock()


def set_partial(
    track_id: str, bands: np.ndarray | None = None, duration: float = 0
) -> None:
    """Mark a track as being analysed, with the band envelopes measured so far."""
    with _partial_lock:
        _partial[track_id] = (np.zeros((8, 0)) if bands is None else bands, duration)


def drop_partial(track_id: str) -> None:
    with _partial_lock:
        _partial.pop(track_id, None)


def partial(ids: list[str]) -> dict[str, dict[str, Any]]:
    """The tracks of *ids* being analysed: their bands so far, normalised like ``get``'s."""
    with _partial_lock:
        found = {i: _partial[i] for i in ids if i in _partial}
    if not found:
        return {}
    norm = (_get_state() or renormalise())["norm"]
    out: dict[str, dict[str, Any]] = {}
    for tid, (bands, duration) in found.items():
        n = bands.shape[1]
        out[tid] = {
            "id": tid,
            "partial": True,
            "duration": round(duration, 2),
            "progress": round(min(1.0, n / 10 / duration), 3) if duration else 0.0,
            "bands": [_percent(bands[i], norm[i]) for i in range(8)],
        }
    return out


def _spellings() -> dict[str, str]:
    """The genre spelling to show for each grouping key: the one most tracks
    use, then the one with more words ("Synth Pop" over "Synthpop")."""
    with library._lock:
        rows = (
            library._connect()
            .execute(
                "SELECT coalesce(json_extract(extra, '$.genre_override'),"
                " json_extract(extra, '$.genre')) AS g FROM music_analysis"
            )
            .fetchall()
        )
    count = Counter(genres.spell(r["g"]) for r in rows if isinstance(r["g"], str))
    best: dict[str, str] = {}
    for name, _ in sorted(
        count.items(), key=lambda kv: (-kv[1], -kv[0].count(" "), kv[0])
    ):
        best.setdefault(genres._key(name), name)
    return best
