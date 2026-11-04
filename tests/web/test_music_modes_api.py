from __future__ import annotations

import json

from sestudio import library
from sestudio.music import store
from tests.web.test_music_playlists import A, B, client  # noqa: F401

UNSURE = {
    "tonic": "E",
    "mode": "Aeolian",
    "notes": ["E", "F#", "G", "A", "B", "C", "D"],
    "brightness": -1,
    "contrast": 0.55,
    "tonic_share": 0.8,
    "unsure": True,
    "alt": "E Phrygian",
    "reason": "the notes that would decide (F#, F) are both played",
}


def _analysed(track_id: str, extra: dict) -> None:
    conn = library._connect()
    conn.execute(
        "INSERT INTO music_analysis (track_id, mtime, size, analysed_at, duration, zcr,"
        " bpm, n, bands, loudness, extra) VALUES (?, 0, 0, 0, 1, 0, 174, 1, ?, ?, ?)",
        (track_id, bytes(16), bytes(2), json.dumps(extra)),
    )
    conn.commit()


def test_settle_an_unsure_mode_by_ear(client):  # noqa: F811
    _analysed(A, {"harmony": {"track": UNSURE, "intro": UNSURE}})
    assert client.get("/api/music/analysis/unsure").json() == {"count": 1, "ids": [A]}
    got = client.get(f"/api/music/tracks/{A}/analysis").json()["harmony"]["track"]
    assert (got["mode"], got["source"], got["unsure"]) == ("Aeolian", "detected", True)

    r = client.put(
        f"/api/music/tracks/{A}/mode", json={"tonic": "E", "mode": "Phrygian"}
    )
    assert r.status_code == 200
    h = client.get(f"/api/music/tracks/{A}/analysis").json()["harmony"]
    assert h["track"]["mode"] == "Phrygian"
    assert h["track"]["notes"] == ["E", "F", "G", "A", "B", "C", "D"]
    assert h["track"]["brightness"] == -2
    assert (h["track"]["source"], h["track"]["detected"]) == ("user", "E Aeolian")
    assert h["track"]["unsure"] is False
    assert h["intro"]["mode"] == "Aeolian"  # only the whole track is settled
    assert client.get("/api/music/analysis/unsure").json()["count"] == 0

    store.set_extra(A, {"harmony": {"track": UNSURE}})  # a re-profile keeps the choice
    assert store.get([A])[A]["harmony"]["track"]["mode"] == "Phrygian"

    assert client.put(f"/api/music/tracks/{A}/mode", json={}).status_code == 200
    assert client.get("/api/music/analysis/unsure").json()["count"] == 1


def test_mode_choice_is_checked(client):  # noqa: F811
    _analysed(A, {"harmony": {"track": UNSURE}})
    url = f"/api/music/tracks/{A}/mode"
    assert client.put(url, json={"tonic": "H", "mode": "Dorian"}).status_code == 400
    assert client.put(url, json={"tonic": "E", "mode": "Bluesy"}).status_code == 400
    assert client.put(url, json={"tonic": "E"}).status_code == 400
    other = f"/api/music/tracks/{B}/mode"
    assert client.put(other, json={"tonic": "E", "mode": "Dorian"}).status_code == 404
