"""Audio files as library entries: names, ids, mime types, listing, playback."""

from __future__ import annotations

import subprocess

import pytest
from fastapi.testclient import TestClient

from sestudio import downloaded, library
from sestudio.media import ffmpeg_binary
from sestudio.web.app import create_app

# The SoundCloud test folder: no tags, so the file name is all there is.
NAMES = [
    "A Taste Of Hope (Emperor Remix) [1211932210].m4a",
    "Aurora (Justin Hawkes Remix) [feat. Metrik] [1649625993].opus",
    "Best Of Me ft. Dia Frampton [2265284741].m4a",
    "Black Bloc [1297561282].m4a",
    "D Minds & Mefjus  - Systematic [1300429510].m4a",
    "Dodge & Fuski - I'm Back [2167173651].m4a",
    "Dune [362589008].m4a",
    "Eluun - Hear The Lies [Premiere] [2123089707].m4a",
    "Eluun - You left me [2129603343].m4a",
    "Emperor - All I Ever Wanted [1051381489].m4a",
    "Emperor - Sunder [857726134].m4a",
    "Emperor - These Days [893801773].m4a",
    "Fade Black - Elysium [1163179054].m4a",
    "Farewell [1284259510].m4a",
    "Halogenix - Blej (Fade Black Remix) [706382086].m4a",
    "Hear Me [1149697852].m4a",
    "If I Could (OUT NOW) [407105157].m4a",
    "Kumarion - Pure Action [1041756799].m4a",
    "Kumarion - Wanna [829698373].m4a",
    "Maysev - Left [1972033107].m4a",
    "Maysev & The Caracal Project - Before You [1972033083].m4a",
    "Mefjus & Maksim MC - Dopamine Hits [1940037482].m4a",
    "Noisia - Concussion (Mefjus Remix) [1366004821].m4a",
    "Nonplus [697001737].m4a",
    "No Way Out (feat. Mira Lu Kovacs) [1342673869].opus",
    "Perseverance [1824195963].opus",
    "Physically (OUT NOW) [436456395].m4a",
    "Pray For Me (feat. Joe Killington) [1772762169].opus",
    "Scorched Earth [1931456546].m4a",
    "Sh＊t's On F＊re [2245312973].m4a",
    "Sidewinder - Mefjus & Camo & Krooked [693205096].m4a",
    "Sinkhole (OUT NOW) [428595336].m4a",
    "Skrillex, Noisia, josh pan & Dylan Brady - Supersonic (My Existence) [1065012607].m4a",
    "Skylark - Stargazer [1520844169].m4a",
    "Sota, Circadian, Mila Falls - Mesmer [1585728627].m4a",
    "Suicide Bassline VIP [243238995].m4a",
    "Teddy Killerz - Noir [899431270].m4a",
    "The Hole [1708204287].m4a",
    "Virtual Riot & Autodrive - Nightmare feat. Splitbreed [191408547].m4a",
    "Virtual Riot & DIESEL - Damage ft. Shaquille O'Neal [2025086752].m4a",
    "Virtual Riot, Dodge & Fuski - Found You ft. CHROME [2299706891].m4a",
    "Virtual Riot - So Sorry (RANKZ Remix) [1775448219].m4a",
    "Virtual Riot - Statues [2299706882].m4a",
    "Virtual Riot, Tokyo Machine - The First Time [2299706879].m4a",
    "Waeys, Bensley & Hoax - Twerp [1964158847].m4a",
    "Without Them [1161092662].m4a",
]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    library._conn = None
    downloaded.invalidate()
    c = TestClient(create_app())
    c.put("/api/settings", json={"output_root": str(tmp_path / "out")})
    return c


def test_parser_on_the_real_names():
    assert len(NAMES) == 46
    parsed = {n: downloaded.parse_track_name(n.rsplit(".", 1)[0]) for n in NAMES}
    for artist, title in parsed.values():
        assert title
        assert "[" not in artist
        assert not title[-1].isdigit() or "[" not in title
    assert parsed["Emperor - Sunder [857726134].m4a"] == ("Emperor", "Sunder")
    assert parsed["Dune [362589008].m4a"] == ("", "Dune")
    # Two spaces before the dash, a bracketed tag that is not the id, a feat.
    assert parsed["D Minds & Mefjus  - Systematic [1300429510].m4a"] == (
        "D Minds & Mefjus",
        "Systematic",
    )
    assert parsed["Eluun - Hear The Lies [Premiere] [2123089707].m4a"] == (
        "Eluun",
        "Hear The Lies [Premiere]",
    )
    assert parsed["Aurora (Justin Hawkes Remix) [feat. Metrik] [1649625993].opus"] == (
        "",
        "Aurora (Justin Hawkes Remix) [feat. Metrik]",
    )
    assert parsed["Sidewinder - Mefjus & Camo & Krooked [693205096].m4a"] == (
        "Sidewinder",
        "Mefjus & Camo & Krooked",
    )


@pytest.mark.parametrize(
    "name,mime",
    [
        ("a.m4a", "audio/mp4"),
        ("a.mp3", "audio/mpeg"),
        ("a.opus", "audio/ogg"),
        ("a.ogg", "audio/ogg"),
        ("a.FLAC", "audio/flac"),
        ("a.wav", "audio/wav"),
        ("a.mp4", "video/mp4"),
    ],
)
def test_media_types(name, mime):
    assert downloaded.media_type_for(name) == mime


def _listing(client):
    return client.get("/api/downloaded").json()


def test_audio_listed_with_ids_stable_across_rescans(client, tmp_path):
    out = tmp_path / "out"
    (out / "Album").mkdir(parents=True)
    (out / "Album" / "Emperor - Sunder [857726134].m4a").write_bytes(b"x")
    (out / "Dune [362589008].opus").write_bytes(b"x")
    (out / "Film.mp4").write_bytes(b"x")

    first = _listing(client)
    downloaded.invalidate()
    downloaded._audio_infos.clear()
    second = _listing(client)
    assert first == second

    audio = {g["key"]: g for g in first if g["kind"] == "audio"}
    assert len(audio) == 2
    track = audio["Album|S0|audio"]["files"][0]
    assert (track["artist"], track["title"]) == ("Emperor", "Sunder")
    assert (track["library"], track["source"]) == ("local", "file")
    assert track["id"] == downloaded.track_id("Album/Emperor - Sunder [857726134].m4a")
    assert [g["kind"] for g in first].count("video") == 1
    assert len({f["id"] for g in audio.values() for f in g["files"]}) == 2


def test_track_id_depends_on_library_and_path():
    assert downloaded.track_id("a.m4a") == downloaded.track_id("a.m4a")
    assert downloaded.track_id("a.m4a") != downloaded.track_id("b.m4a")
    assert downloaded.track_id("a.m4a") != downloaded.track_id("a.m4a", "nas")


def test_tags_win_over_the_name_and_file_plays_with_ranges(client, tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    file = out / "whatever [1].mp3"
    made = subprocess.run(
        [
            ffmpeg_binary(),
            "-nostdin",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=duration=1",
            "-metadata",
            "title=Real Title",
            "-metadata",
            "artist=Real Artist",
            "-metadata",
            "album=Real Album",
            str(file),
        ],
        check=False,
    )
    if made.returncode != 0:
        pytest.skip("ffmpeg cannot encode mp3 here")

    track = _listing(client)[0]["files"][0]
    assert (track["artist"], track["title"], track["album"]) == (
        "Real Artist",
        "Real Title",
        "Real Album",
    )
    assert track["duration"] == pytest.approx(1.0, abs=0.2)

    resp = client.get(
        "/api/downloaded/file",
        params={"path": track["path"]},
        headers={"Range": "bytes=0-9"},
    )
    assert resp.status_code == 206
    assert resp.headers["content-type"] == "audio/mpeg"
    assert len(resp.content) == 10
