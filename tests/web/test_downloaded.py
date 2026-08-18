from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sestudio import downloaded, library
from sestudio.web.app import create_app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    # The module keeps one connection and a scan cache for the process; both must
    # be reset per test or state leaks between them.
    library._conn = None
    downloaded.invalidate()
    app = create_app()
    c = TestClient(app)
    c.put("/api/settings", json={"output_root": str(tmp_path / "out")})
    return c


@pytest.fixture()
def out(tmp_path):
    return tmp_path / "out"


def _write(path, body=b"VIDEO"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)


def _titles(client):
    resp = client.get("/api/downloaded")
    assert resp.status_code == 200
    return resp.json()


def test_empty_root_lists_nothing(client):
    assert _titles(client) == []


def test_groups_episodes_by_series_and_season(client, out):
    _write(out / "My Show" / "Season 01" / "VF" / "S01E01 - Pilot.mp4")
    _write(out / "My Show" / "Season 01" / "VOSTFR" / "S01E02 - Deux.mp4")
    _write(out / "My Show" / "Season 02" / "VF" / "S02E01 - Return.mp4")

    titles = _titles(client)
    assert len(titles) == 2

    first = next(t for t in titles if t["season"] == 1)
    assert first["series"] == "My Show"
    assert first["is_film"] is False
    assert sorted(first["langs"]) == ["vf", "vostfr"]
    assert [(f["number"], f["lang"], f["title"]) for f in first["files"]] == [
        (1, "vf", "Pilot"),
        (2, "vostfr", "Deux"),
    ]


def test_films_are_their_own_titles(client, out):
    _write(out / "sestudio_films" / "VF" / "Some Film.mp4")

    (title,) = _titles(client)
    assert title["is_film"] is True
    assert title["season"] == 0
    assert title["series"] == "Some Film"
    assert title["files"][0]["lang"] == "vf"


def test_ignores_unplayable_files_but_finds_the_rest(client, out):
    _write(out / "My Show" / "Season 01" / "VF" / "S01E01 - Ok.mp4")
    _write(out / "My Show" / "Season 01" / "VF" / "S01E02 - Partial.mp4.part")
    _write(out / "My Show" / "Season 01" / "VF" / "S01E03 - Empty.mp4", b"")
    # Not in a season folder, so not an episode — but still a video the owner
    # has, and the shelf is about what they have.
    _write(out / "My Show" / "Extras" / "behind the scenes.mp4")
    _write(out / "Holiday Photos" / "note.txt")

    titles = _titles(client)
    season = next(t for t in titles if t["season"] == 1)
    assert [f["title"] for f in season["files"]] == ["Ok"]

    # The partial, the empty one and the text file are not on the shelf.
    every_file = [f["title"] for t in titles for f in t["files"]]
    assert "Partial" not in every_file
    assert "Empty" not in every_file
    assert "note" not in every_file
    assert "behind the scenes" in every_file


def test_finds_a_film_loose_in_the_root(client, out):
    # A collection that predates this tool sits wherever it was put.
    _write(out / "Old Film.mkv")
    _write(out / "Movies" / "Another Film.avi")

    titles = _titles(client)
    names = sorted(t["series"] for t in titles)
    assert names == ["Another Film", "Old Film"]
    assert all(t["is_film"] for t in titles)


def test_finds_a_series_without_the_tool_s_layout(client, out):
    # No `Season NN` folder and no language folder — the filename carries it.
    _write(out / "Some Show" / "Some.Show.S02E03.1080p.mkv")
    _write(out / "Some Show" / "Some.Show.S02E04.1080p.mkv")

    (title,) = _titles(client)
    assert title["series"] == "Some Show"
    assert title["season"] == 2
    assert title["is_film"] is False
    assert [f["number"] for f in title["files"]] == [3, 4]


def test_reads_the_1x02_spelling(client, out):
    _write(out / "Other Show" / "Season 01" / "Other Show - 1x02.mp4")

    (title,) = _titles(client)
    assert title["files"][0]["number"] == 2


def test_manifest_supplies_the_unsanitised_name_and_poster(client, out):
    _write(out / "My Show- Origins" / "Season 01" / "VF" / "S01E01 - Pilot.mp4")
    library.set_downloaded_file(
        "My Show- Origins/Season 01/VF/S01E01 - Pilot.mp4",
        {
            "series_name": "My Show: Origins",
            "season": 1,
            "lang": "vf",
            "source": "senpai",
            "poster_url": "https://example.test/p.jpg",
            "page_url": "https://example.test/show",
        },
    )
    downloaded.invalidate()

    (title,) = _titles(client)
    # The folder is lossy (":" became "-"); the manifest restores the real name.
    assert title["series"] == "My Show: Origins"
    assert title["poster_url"] == "https://example.test/p.jpg"
    assert title["page_url"] == "https://example.test/show"
    assert title["source"] == "senpai"


def test_falls_back_to_the_folder_name_without_a_manifest(client, out):
    _write(out / "My Show- Origins" / "Season 01" / "VF" / "S01E01 - Pilot.mp4")

    (title,) = _titles(client)
    assert title["series"] == "My Show- Origins"
    assert title["poster_url"] == ""


# --- serving ---------------------------------------------------------------- #

REL = "My Show/Season 01/VF/S01E01 - Pilot.mp4"


@pytest.fixture()
def served(client, out):
    _write(out / "My Show" / "Season 01" / "VF" / "S01E01 - Pilot.mp4", b"0123456789")
    return client


def test_serves_the_file_inline(served):
    resp = served.get("/api/downloaded/file", params={"path": REL})
    assert resp.status_code == 200
    assert resp.content == b"0123456789"
    assert resp.headers["content-type"] == "video/mp4"
    # Inline, not an attachment: this route is for playing, not saving.
    assert "content-disposition" not in resp.headers
    # The Cast receiver refuses media without these.
    assert resp.headers["access-control-allow-origin"] == "*"


def test_head_advertises_range_support(served):
    resp = served.head("/api/downloaded/file", params={"path": REL})
    assert resp.status_code == 200
    # The DLNA renderer probes with HEAD before playing.
    assert resp.headers["accept-ranges"] == "bytes"


def test_range_request_returns_a_partial_body(served):
    resp = served.get(
        "/api/downloaded/file", params={"path": REL}, headers={"Range": "bytes=2-5"}
    )
    # Seeking in the browser depends on this.
    assert resp.status_code == 206
    assert resp.content == b"2345"
    assert resp.headers["content-range"] == "bytes 2-5/10"


@pytest.mark.parametrize(
    "path",
    [
        "../../../etc/passwd",
        "/etc/passwd",
        "My Show/../../escape.mp4",
    ],
)
def test_traversal_is_refused(served, path):
    assert served.get("/api/downloaded/file", params={"path": path}).status_code == 403


def test_missing_file_is_404(served):
    resp = served.get("/api/downloaded/file", params={"path": "My Show/nope.mp4"})
    assert resp.status_code == 404


def test_delete_removes_one_file_and_its_manifest_row(served, out):
    sibling = out / "My Show" / "Season 01" / "VF" / "S01E02 - Deux.mp4"
    _write(sibling)
    library.set_downloaded_file(REL, {"series_name": "My Show"})
    downloaded.invalidate()

    resp = served.delete("/api/downloaded/file", params={"path": REL})
    assert resp.status_code == 200

    assert not (out / REL).exists()
    assert sibling.exists()  # only the one asked for
    assert REL not in library.downloaded_files()


def test_delete_refuses_traversal(served):
    assert (
        served.delete(
            "/api/downloaded/file", params={"path": "../../etc/passwd"}
        ).status_code
        == 403
    )


# --- season (opening a title that exists only on disk) ---------------------- #


def test_season_from_files_matches_the_regular_shape(client, out):
    _write(out / "My Show" / "Season 01" / "VF" / "S01E01 - Pilot.mp4")
    _write(out / "My Show" / "Season 01" / "VOSTFR" / "S01E01 - Le pilote.mp4")
    _write(out / "My Show" / "Season 01" / "VF" / "S01E02 - Deux.mp4")
    downloaded.invalidate()

    body = client.get(
        "/api/downloaded/season", params={"series": "My Show", "season": 1}
    ).json()

    assert body["season"] == 1
    assert body["is_film"] is False
    assert body["source"] == "downloaded"
    assert sorted(body["available_langs"]) == ["vf", "vostfr"]

    # One entry per episode, carrying every language it exists in — the same
    # contract a site's page provides, so the watch view needs no special case.
    assert [e["number"] for e in body["episodes"]] == [1, 2]
    assert sorted(body["episodes"][0]["langs"]) == ["vf", "vostfr"]
    assert body["episodes"][1]["langs"] == ["vf"]
    # No host to resolve: the client pairs each episode with its file.
    assert body["episodes"][0]["embed_urls"] == {}


def test_season_uses_the_manifest_name(client, out):
    _write(out / "My Show- Origins" / "Season 01" / "VF" / "S01E01 - Pilot.mp4")
    library.set_downloaded_file(
        "My Show- Origins/Season 01/VF/S01E01 - Pilot.mp4",
        {"series_name": "My Show: Origins", "season": 1, "lang": "vf"},
    )
    downloaded.invalidate()

    # Opened under the real name, which is what the listing shows.
    assert (
        client.get(
            "/api/downloaded/season", params={"series": "My Show: Origins", "season": 1}
        ).status_code
        == 200
    )


def test_season_404s_for_a_title_not_on_disk(client):
    resp = client.get("/api/downloaded/season", params={"series": "Nope", "season": 1})
    assert resp.status_code == 404


# --- thumbnails (a still for a title TMDB has no poster for) ---------------- #


def _ffmpeg_or_skip():
    from sestudio.media import ffmpeg_binary

    try:
        return ffmpeg_binary()
    except RuntimeError:  # pragma: no cover — depends on the machine
        pytest.skip("no ffmpeg available")


def test_thumbnail_is_generated_and_cached(client, out, tmp_path):
    import subprocess

    ff = _ffmpeg_or_skip()
    clip = out / "Old Film.mp4"
    clip.parent.mkdir(parents=True, exist_ok=True)
    # Eight seconds, so the 120s seek finds nothing and the fallback is used.
    subprocess.run(
        [
            ff,
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=320x240:rate=10",
            "-t",
            "8",
            "-pix_fmt",
            "yuv420p",
            str(clip),
        ],
        check=True,
    )
    downloaded.invalidate()

    resp = client.get("/api/downloaded/thumb", params={"path": "Old Film.mp4"})
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"
    assert resp.content[:3] == b"\xff\xd8\xff"  # a real JPEG, not an empty file

    # Second call is served from the cache — same bytes, no second ffmpeg run.
    again = client.get("/api/downloaded/thumb", params={"path": "Old Film.mp4"})
    assert again.content == resp.content


def test_thumbnail_refuses_traversal(client):
    resp = client.get("/api/downloaded/thumb", params={"path": "../../etc/passwd"})
    assert resp.status_code == 403


def test_serves_mkv_with_its_own_media_type(client, out):
    _write(out / "Old Film.mkv")
    downloaded.invalidate()

    resp = client.get("/api/downloaded/file", params={"path": "Old Film.mkv"})
    assert resp.status_code == 200
    # Not video/mp4: a player that trusts the type would be misled.
    assert resp.headers["content-type"] == "video/x-matroska"


# --- a folder of loose episodes is one show, not a thousand films ---------- #


def test_numbered_run_becomes_one_series_named_by_its_folder(client, out):
    for i in range(1, 12):
        _write(out / "One Piece" / f"One Piece {i:04d}.mkv")
    downloaded.invalidate()

    (title,) = _titles(client)
    # One card, not eleven — and named for the folder, which is a name TMDB can
    # actually answer, unlike "One Piece 0001".
    assert title["series"] == "One Piece"
    assert title["is_film"] is False
    assert len(title["files"]) == 11
    assert [f["number"] for f in title["files"]][:3] == [1, 2, 3]


def test_a_folder_of_distinct_films_stays_one_card_each(client, out):
    for name in ("Inception", "Arrival", "Dune"):
        _write(out / "Movies" / f"{name}.mkv")
    downloaded.invalidate()

    titles = _titles(client)
    assert sorted(t["series"] for t in titles) == ["Arrival", "Dune", "Inception"]
    assert all(t["is_film"] for t in titles)


def test_a_trilogy_is_not_mistaken_for_a_numbered_run(client, out):
    # A long shared prefix, but the difference is a word — not a sequence.
    for name in ("The Matrix", "The Matrix Reloaded", "The Matrix Revolutions"):
        _write(out / "Matrix" / f"{name}.mkv")
    downloaded.invalidate()

    titles = _titles(client)
    assert len(titles) == 3
    assert all(t["is_film"] for t in titles)


def test_structured_content_is_left_alone(client, out):
    _write(out / "My Show" / "Season 02" / "VF" / "S02E01 - One.mp4")
    _write(out / "My Show" / "Season 02" / "VF" / "S02E02 - Two.mp4")
    _write(out / "My Show" / "Season 02" / "VF" / "S02E03 - Three.mp4")
    downloaded.invalidate()

    (title,) = _titles(client)
    assert title["season"] == 2  # not rewritten to 1 by the run heuristic
    assert [f["number"] for f in title["files"]] == [1, 2, 3]


def test_listing_reports_the_folder_that_named_the_title(client, out):
    _write(out / "Anime" / "One Piece" / "Season 01" / "VF" / "S01E01 - Go.mp4")
    _write(out / "Movies" / "Inception.mkv")
    _write(out / "Loose.mkv")
    downloaded.invalidate()

    by_series = {t["series"]: t["folder"] for t in _titles(client)}
    # Season and language folders are stripped: what is left is what named it,
    # and it is a path so two shows called alike under different parents differ.
    assert by_series["One Piece"] == "Anime/One Piece"
    assert by_series["Inception"] == "Movies"
    # Loose in the root: no folder named it at all.
    assert by_series["Loose"] == ""


def test_a_file_without_a_language_folder_gets_one(client, out):
    # Hand-placed, or fetched before the app sorted files by language. It used
    # to end up with no language at all, and the watch view — which pairs an
    # episode with a file by language — could then never play it.
    _write(out / "Loose Show" / "Season 02" / "S02E06 - Le feu.mp4")
    downloaded.invalidate()

    (title,) = _titles(client)
    assert title["langs"] == [downloaded.UNKNOWN_LANG]
    assert title["files"][0]["lang"] == downloaded.UNKNOWN_LANG

    body = client.get(
        "/api/downloaded/season", params={"series": "Loose Show", "season": 2}
    ).json()
    assert body["available_langs"] == [downloaded.UNKNOWN_LANG]
    assert body["episodes"][0]["langs"] == [downloaded.UNKNOWN_LANG]


# --- DLNA seeking (a TV asks in time, not in bytes) ------------------------- #


def _clip(out, name="Old Film.mp4", seconds="8"):
    from sestudio.media import ffmpeg_binary
    import subprocess

    try:
        ff = ffmpeg_binary()
    except RuntimeError:  # pragma: no cover — depends on the machine
        pytest.skip("no ffmpeg available")
    target = out / name
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            ff,
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=320x240:rate=10",
            "-t",
            seconds,
            "-pix_fmt",
            "yuv420p",
            str(target),
        ],
        check=True,
    )
    downloaded.invalidate()
    return target


def test_advertises_time_and_byte_seek_when_the_duration_is_known(client, out):
    _clip(out)
    resp = client.head("/api/downloaded/file", params={"path": "Old Film.mp4"})
    assert resp.status_code == 200
    # OP=11: time-seek then byte-seek. Told nothing, a renderer decides for
    # itself and refuses on anything it cannot index.
    assert "DLNA.ORG_OP=11" in resp.headers["contentfeatures.dlna.org"]
    assert resp.headers["accept-ranges"] == "bytes"


def test_time_seek_returns_the_matching_byte_range(client, out):
    clip = _clip(out)
    size = clip.stat().st_size

    resp = client.get(
        "/api/downloaded/file",
        params={"path": "Old Film.mp4"},
        headers={"TimeSeekRange.dlna.org": "npt=4.000-"},
    )
    assert resp.status_code == 206
    # Answered in time as well as bytes, which is what the renderer reads back.
    assert "npt=4.000-" in resp.headers["timeseekrange.dlna.org"]
    assert f"/{size}" in resp.headers["content-range"]
    # Roughly half the file, since the seek was to half of an 8s clip.
    offset = int(resp.headers["content-range"].split()[1].split("-")[0])
    assert 0 < offset < size
    assert len(resp.content) == size - offset


def test_time_seek_accepts_the_clock_spelling(client, out):
    _clip(out)
    resp = client.get(
        "/api/downloaded/file",
        params={"path": "Old Film.mp4"},
        headers={"TimeSeekRange.dlna.org": "npt=00:00:02.000-"},
    )
    assert resp.status_code == 206
    assert "npt=2.000-" in resp.headers["timeseekrange.dlna.org"]


def test_byte_seek_still_works_untouched(client, out):
    _clip(out)
    resp = client.get(
        "/api/downloaded/file",
        params={"path": "Old Film.mp4"},
        headers={"Range": "bytes=0-99"},
    )
    assert resp.status_code == 206
    assert len(resp.content) == 100
