"""The station's audio mix: boundaries checked on generated tones."""

import json
import subprocess
from pathlib import Path

import numpy as np
import pytest

from sestudio.media import ffmpeg_binary
from sestudio.music import mixer, mixplan

SR = mixer.SR
VECTORS = Path(__file__).parent / "fixtures" / "mixplan_vectors.json"


def test_python_plan_matches_the_shared_vectors():
    for c in json.loads(VECTORS.read_text()):
        a = mixplan.prep_track(c["a"]["dur"], c["a"]["raw"])
        b = mixplan.prep_track(c["b"]["dur"], c["b"]["raw"])
        assert [t["segs"] for t in c["tracks"]] == [
            [list(g) for g in a.segs],
            [list(g) for g in b.segs],
        ]
        assert [(t["dur"], t["bpm"], t["bar0"]) for t in c["tracks"]] == [
            (a.dur, a.bpm, a.bar0),
            (b.dur, b.bpm, b.bar0),
        ]
        p, want = mixplan.plan(a, b, c["settings"]), c["plan"]
        assert (p.mode, p.why) == (want["mode"], want["why"])
        for got, key in [
            (p.mix_out, "mixOut"),
            (p.len, "len"),
            (p.start_off, "startOff"),
            (p.rate, "rate"),
        ]:
            assert got == pytest.approx(want[key], abs=1e-9)
        if p.mode == "sync":
            assert (p.bars, p.swap) == (want["bars"], want["swap"])


def tone(path: Path, hz: float, seconds: float, amp: float = 0.5) -> str:
    subprocess.run(
        [ffmpeg_binary(), "-v", "error", "-y", "-f", "lavfi", "-i",
         f"sine=frequency={hz}:duration={seconds}:sample_rate={SR}",
         "-af", f"volume={amp * 8}", "-ac", "2", str(path)],
        check=True,
    )  # fmt: skip
    return str(path)


class FakePort:
    def __init__(self, ids: list[str], **mix: object) -> None:
        self.s = {
            "items": [{"item_id": f"q{i}", "track_id": t, "library": "local"} for i, t in enumerate(ids)],
            "current": 0, "position": 0.0, "updated_at": 0.0, "server_time": 0.0,
            "playing": True, "repeat": False, "default_mix": "fade", "mix": {},
        }  # fmt: skip
        if mix:
            self.s["mix"] = {
                f"{a}>{b}": {
                    "mode": "sync",
                    "bars": 4,
                    "tempo": True,
                    "swap": True,
                    "nudge": 0,
                    **mix,
                }
                for a, b in zip(ids, ids[1:], strict=False)
            }
        self.calls: list[tuple] = []
        self.fns: list = []

    def state(self):
        return self.s

    def next(self):
        self.calls.append(("next",))
        s = self.s
        s["current"] = min(s["current"] + 1, len(s["items"]) - 1)
        s["position"] = 0.0

    def seek(self, position):
        self.calls.append(("seek", position))
        self.s["position"] = position

    def listen(self, fn):
        self.fns.append(fn)
        return lambda: None

    def emit(self, **ev):
        for fn in self.fns:
            fn(ev)


class Files:
    def __init__(self, files: dict[str, tuple[str, dict | None]]) -> None:
        self.files = files

    def audio(self, item):
        return self.files[item["track_id"]]


def level(x: np.ndarray, at: float, width: float = 0.05) -> float:
    w = x[int(at * SR) : int((at + width) * SR)]
    return float(np.sqrt(np.mean(w**2)))


def energy(x: np.ndarray, at: float, hz: float, width: float = 0.4) -> float:
    n = int(width * SR)
    w = x[int(at * SR) : int(at * SR) + n, 0] * np.hanning(n)
    f = np.abs(np.fft.rfft(w, n=SR * 2))
    k = round(hz * 2)
    return float(np.sum(f[k - 6 : k + 7] ** 2))


def clean(x: np.ndarray, step: float) -> None:
    """No click: no sample jumps further than a tone at these levels can."""
    assert float(np.max(np.abs(np.diff(x, axis=0)))) < step


def make(tmp_path, ids_hz, seconds, **mix):
    files = {}
    for tid, (hz, analysis) in ids_hz.items():
        files[tid] = (tone(tmp_path / f"{tid}.wav", hz, seconds), analysis)
    port = FakePort(list(ids_hz), **mix)
    return mixer.Mixer(port, Files(files)), port


def test_a_fade_keeps_the_level_up_and_makes_no_click(tmp_path):
    m, port = make(tmp_path, {"a": (440, None), "b": (660, None)}, 14)
    x = m.render_seconds(18.5)
    # Track a ends 4 s into the fade at 10 s; the queue moved on once, at the start of it.
    assert port.calls[0] == ("next",)
    levels = [level(x, t) for t in np.arange(8, 17, 0.1)]
    assert min(levels) > 0.22 and max(levels) < 0.28  # equal power: steady 0.25
    clean(x, 0.2)
    assert energy(x, 9.0, 660) < 1e-3 * energy(x, 9.0, 440)
    assert energy(x, 14.5, 440) < 1e-3 * energy(x, 14.5, 660)
    assert (
        energy(x, 11.8, 440) > 0.3 * energy(x, 11.8, 660) > 0.1 * energy(x, 11.8, 440)
    )


def test_a_beat_sync_blends_for_its_bars_and_swaps_the_basses(tmp_path):
    a = {"bpm": 120, "bar0": 0.0}
    b = {"bpm": 126, "bar0": 0.0}
    m, port = make(tmp_path, {"a": (80, a), "b": (90, b)}, 40, bars=4)
    x = m.render_seconds(36)
    # 4 bars at 120 BPM = 8 s, starting on the 4-bar phrase before the end: 24 s.
    assert [c[0] for c in port.calls] == ["next", "seek"]
    assert port.calls[1][1] == 0.0
    clean(x, 0.2)
    assert level(x, 23.5) == pytest.approx(level(x, 33.5), rel=0.1)
    e = lambda t, hz: energy(x, t, hz)  # noqa: E731
    assert e(23.0, 90) < 1e-3 * e(23.0, 80)
    assert e(32.6, 80) < 1e-3 * e(32.6, 90)
    # The bass of the incoming track is held down in the first half, the outgoing one in the second.
    assert e(26.0, 90) < 0.02 * e(26.0, 80)
    assert e(30.0, 80) < 0.02 * e(30.0, 90)
    # b entered at its downbeat at the tempo of a (120/126), and is still gliding back to its own.
    item, pos = m._where()
    assert item == "q1"
    assert 8 * 120 / 126 < pos < 8 * 120 / 126 + 4 * 1.0


def test_the_incoming_tempo_glides_back_to_its_own_over_32_beats():
    full = (np.sin(np.arange(SR * 60) * 0.05)[:, None] * [8000, 8000]).astype(np.int16)
    p = mixplan.plan(
        mixplan.Track(60, 120, 0.0), mixplan.Track(60, 126, 0.0),
        {"mode": "sync", "bars": 4, "tempo": True, "swap": False, "nudge": 0},
    )  # fmt: skip
    v = mixer.incoming(full, p)
    assert p.rate == pytest.approx(120 / 126)
    # The blend: 8 s of output covers 8 * rate seconds of the track.
    assert v.src_at(8 * SR) == pytest.approx(8 * 120 / 126, abs=0.03)
    # Then 32 beats of 126 BPM bring the rate to 1: from there on, 1 s of output is 1 s of track.
    end = round((8 + 32 * 60 / 126) * SR)
    assert v.src_at(end + SR) - v.src_at(end) == pytest.approx(1, abs=0.01)
    assert (
        v.src_at(9 * SR) - v.src_at(8 * SR) < 0.96
    )  # the glide starts at the matched tempo


def test_a_skip_cuts_over_in_a_blink_without_a_click(tmp_path):
    m, port = make(tmp_path, {"a": (440, None), "b": (660, None)}, 14)
    x1 = m.render_seconds(2)
    port.s.update(current=1, position=3.0)
    port.emit(op="go", item_id="q1", index=1, playing=True)
    x2 = m.render_seconds(1)
    x = np.concatenate([x1, x2])
    clean(x, 0.2)
    assert energy(x, 1.5, 660) < 1e-3 * energy(x, 1.5, 440)  # a until the skip
    assert energy(x, 2.6, 440) < 1e-3 * energy(x, 2.6, 660)  # b alone
    assert m._where()[0] == "q1"


def test_pause_fades_out_and_holds_the_clock(tmp_path):
    m, port = make(tmp_path, {"a": (440, None)}, 14)
    x1 = m.render_seconds(1)
    port.s["playing"] = False
    port.emit(op="transport", action="pause", position=1.0, playing=False)
    x2 = m.render_seconds(1)
    clean(np.concatenate([x1, x2]), 0.2)
    assert level(x2, 0.5) == 0
    p = m._where()[1]
    m.render_seconds(1)
    assert m._where()[1] == p


def test_removing_the_next_track_replans_the_handover(tmp_path):
    m, port = make(tmp_path, {"a": (440, None), "b": (660, None), "c": (880, None)}, 14)
    x1 = m.render_seconds(3)
    del port.s["items"][1]
    port.emit(op="rm", item_id="q1", index=1)
    x = np.concatenate([x1, m.render_seconds(13)])
    clean(x, 0.25)
    assert energy(x, 14.5, 660) < 1e-3 * energy(x, 14.5, 880)
    assert m._where()[0] == "q2"


def test_the_station_clock_follows_what_was_pulled(tmp_path):
    m, port = make(tmp_path, {"a": (440, None)}, 14)
    m._buf.append(m.render_seconds(2))
    m._buffered = len(m._buf[0])
    m.pull(SR)
    h = m.heard()
    assert h and h["item_id"] == "q0" and h["position"] == pytest.approx(1.0, abs=0.05)
