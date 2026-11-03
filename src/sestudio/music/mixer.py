"""The station's audio: the queue rendered as one continuous PCM stream (SPEC-music §7).

It does what the browser engine does, on the server: a 4 s equal-power fade or a
beat sync (:mod:`sestudio.music.mixplan`, the same plan), with the incoming
track's tempo matched by ``atempo`` and glided back to its own over 32 beats,
and the two basses swapped by a 180 Hz low shelf at the midpoint. Start offsets
are sample accurate: the incoming track is prepared as audio on the output's own
clock before it is mixed, so no phase lock is needed.

Audio is rendered a few seconds ahead of what is pulled. Queue changes are read
at the render head: a skip, a seek or a play-now cuts over in 150 ms, edits to
what comes next re-plan the prepared transition.
"""

from __future__ import annotations

import logging
import math
import subprocess
import threading
from collections import OrderedDict, deque
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Protocol

import numpy as np

from sestudio.media import ffmpeg_binary
from sestudio.music import mixplan, queue

log = logging.getLogger(__name__)

SR = 44100
BLOCK = 1024
AHEAD = 3.0  # seconds rendered ahead of what is pulled
GLIDE_BEATS = 32
GLIDE_STEPS = 8
SHELF = "bass=g=-26:f=180:t=s:w=1"
SHELF_TAU = 0.04
CUT = 0.15  # a skip or a seek: seconds of crossfade


class Unplayable(Exception):
    """A queue item that cannot be decoded here."""


class Sources(Protocol):
    def audio(self, item: dict[str, Any]) -> tuple[str, dict[str, Any] | None]:
        """Where the item's audio is (a path or URL) and its analysis, if any."""


class Port(Protocol):
    """What the mixer needs of the queue."""

    def state(self) -> dict[str, Any]: ...
    def next(self) -> None: ...
    def seek(self, position: float) -> None: ...
    def listen(self, fn: Callable[[dict[str, Any]], None]) -> Callable[[], None]: ...


class QueuePort:
    def state(self) -> dict[str, Any]:
        return queue.get_state()

    def next(self) -> None:
        queue.transport("next")

    def seek(self, position: float) -> None:
        queue.transport("seek", position=position)

    def listen(self, fn: Callable[[dict[str, Any]], None]) -> Callable[[], None]:
        return queue.listen(fn)


class LibrarySources:
    def audio(self, item: dict[str, Any]) -> tuple[str, dict[str, Any] | None]:
        from sestudio.music import libraries, online, store

        tid = item["track_id"]
        if (vid := online.video_id(tid)) is not None:
            src = online.resolve(vid)["url"]
        elif (f := libraries.file_for(tid, item.get("library"))) is not None:
            src = str(f)
        else:
            raise Unplayable(f"no audio for {tid}")
        return src, store.get([tid]).get(tid)


# --- audio helpers -------------------------------------------------------------


def _run(args: list[str], data: bytes | None = None) -> np.ndarray:
    cmd = [ffmpeg_binary(), "-v", "error", *args]
    cmd += ["-f", "s16le", "-ac", "2", "-ar", str(SR), "-"]
    raw = subprocess.run(cmd, input=data, capture_output=True, check=True).stdout
    return np.frombuffer(raw[: len(raw) // 4 * 4], dtype=np.int16).reshape(-1, 2)


def decode(src: str) -> np.ndarray:
    """The whole file as 44.1 kHz stereo int16."""
    try:
        out = _run(["-nostdin", "-i", src, "-vn"])
    except subprocess.CalledProcessError as exc:
        raise Unplayable(exc.stderr.decode(errors="replace")[-200:]) from exc
    if not len(out):
        raise Unplayable("no audio")
    return out


def _filtered(arr: np.ndarray, af: str) -> np.ndarray:
    pipe = ["-f", "s16le", "-ar", str(SR), "-ac", "2", "-i", "-"]
    return _run([*pipe, "-af", af], arr.tobytes())


def stretch(arr: np.ndarray, rate: float) -> np.ndarray:
    """*arr* played at *rate*, pitch kept (``atempo``)."""
    return _filtered(arr, f"atempo={rate:.6f}")


def shelved(arr: np.ndarray) -> np.ndarray:
    """The bass-swap shelf applied to *arr*, as float32 in -1..1."""
    return _f(_filtered(arr, SHELF) if len(arr) else arr)


def _f(a: np.ndarray) -> np.ndarray:
    return a.astype(np.float32) / 32768


def _pad(a: np.ndarray, n: int) -> np.ndarray:
    return a if len(a) >= n else np.concatenate([a, np.zeros((n - len(a), 2), a.dtype)])


# --- voices --------------------------------------------------------------------


@dataclass
class Voice:
    """A track's audio on the output clock from where it enters, with the map back
    to the track's own seconds (they differ while its tempo is matched)."""

    arr: np.ndarray
    #: (out start frame, out frames, source start seconds, source seconds)
    segs: list[tuple[int, int, float, float]]
    idx: int = 0

    @classmethod
    def plain(cls, full: np.ndarray, start: float) -> Voice:
        arr = full[min(len(full), round(start * SR)) :]
        return cls(arr, [(0, len(arr), start, len(arr) / SR)])

    def src_at(self, idx: int) -> float:
        for o0, n, s0, sl in self.segs:
            if idx < o0 + n:
                return s0 + (idx - o0) / max(n, 1) * sl
        o0, n, s0, sl = self.segs[-1]
        return s0 + sl + (idx - o0 - n) / SR

    def out_at(self, src: float) -> int:
        for o0, n, s0, sl in self.segs:
            if src < s0 + sl:
                return max(0, o0 + round((src - s0) / max(sl, 1e-9) * n))
        return len(self.arr)

    def take(self, n: int) -> np.ndarray:
        got = _f(_pad(self.arr[self.idx : self.idx + n], n))
        self.idx += n
        return got


def incoming(full: np.ndarray, p: mixplan.Plan | None) -> Voice:
    """A track as it enters under plan *p*: tempo-matched for the blend, then glided back
    to its own over 32 of its beats in a few constant-rate steps."""
    start = p.start_off if p else 0.0
    if p is None or p.mode != "sync" or abs(p.rate - 1) < 5e-4:
        return Voice.plain(full, start)
    glide = GLIDE_BEATS * 60 / p.bpm_b
    steps = [(p.len, p.rate)]
    for j in range(GLIDE_STEPS):
        q = (j + 0.5) / GLIDE_STEPS
        steps.append(
            (glide / GLIDE_STEPS, 1 + (p.rate - 1) * (1 - q * q * (3 - 2 * q)))
        )
    pieces: list[np.ndarray] = []
    segs: list[tuple[int, int, float, float]] = []
    s0, o0 = start, 0
    for dt, r in steps:
        part = full[round(s0 * SR) : round((s0 + dt * r) * SR)]
        if not len(part):
            break
        out = stretch(part, r)
        pieces.append(out)
        segs.append((o0, len(out), s0, len(part) / SR))
        o0 += len(out)
        s0 += dt * r
    rest = full[round(s0 * SR) :]
    pieces.append(rest)
    segs.append((o0, len(rest), s0, len(rest) / SR))
    return Voice(np.concatenate(pieces), segs)


@dataclass
class Loaded:
    full: np.ndarray
    track: mixplan.Track


@dataclass
class Prepared:
    key: tuple
    item_id: str
    loaded: Loaded
    plan: mixplan.Plan
    voice: Voice
    #: The swap's shelved copies of the blend, from its first frame.
    a_sh: np.ndarray | None
    b_sh: np.ndarray | None
    a0: int


@dataclass
class Blend:
    voice: Voice
    item_id: str
    loaded: Loaded
    n: int
    a_sh: np.ndarray | None = None
    b_sh: np.ndarray | None = None
    k: int = 0


class Mixer:
    def __init__(
        self,
        port: Port | None = None,
        sources: Sources | None = None,
        ahead: float = AHEAD,
    ) -> None:
        self.port = port or QueuePort()
        self.sources = sources or LibrarySources()
        self.ahead = ahead
        self._lock = threading.Lock()
        self._buf: deque[np.ndarray] = deque()
        self._buffered = 0
        self._rendered = 0
        self._consumed = 0
        self._marks: deque[tuple[int, str | None, float, bool]] = deque()
        self.underruns = 0
        # What the render thread owns.
        self._events: deque[dict[str, Any]] = deque()
        self._dirty = True
        self._own = threading.local()
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mixer-prep")
        self._cache: OrderedDict[str, Loaded] = OrderedDict()
        self._cache_lock = threading.Lock()
        self.cur: Voice | None = None
        self.cur_item: str | None = None
        self.cur_loaded: Loaded | None = None
        self.blend: Blend | None = None
        self.playing = False
        self._gain = 0.0
        self._state: dict[str, Any] = {}
        #: (key, future); the future is None once its result has been taken.
        self._prep: tuple[tuple, Future | None] | None = None
        self._ready: Prepared | None = None
        self._jump: tuple[int, str, Future] | None = None
        self._jump_n = 0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._unlisten: Callable[[], None] | None = None

    # --- lifecycle ---------------------------------------------------------------

    def start(self) -> None:
        self._unlisten = self.port.listen(self._on_event)
        self._thread = threading.Thread(target=self._loop, name="mixer", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._unlisten:
            self._unlisten()
        if self._thread:
            self._thread.join(5)
        self._pool.shutdown(wait=False, cancel_futures=True)

    def _loop(self) -> None:
        while not self._stop.is_set():
            if self._buffered < self.ahead * SR:
                try:
                    block = self.render(BLOCK)
                except Exception:  # keep the stream alive: a bad block is silence
                    log.exception("mixer block failed")
                    block = np.zeros((BLOCK, 2), np.float32)
                with self._lock:
                    self._buf.append(block)
                    self._buffered += len(block)
            else:
                self._stop.wait(0.01)

    # --- what the writer reads -----------------------------------------------------

    def pull(self, n: int) -> bytes:
        """Exactly *n* frames of s16le stereo; silence when the render is behind."""
        out = np.zeros((n, 2), np.float32)
        got = 0
        with self._lock:
            while got < n and self._buf:
                b = self._buf[0]
                take = min(len(b), n - got)
                out[got : got + take] = b[:take]
                got += take
                if take == len(b):
                    self._buf.popleft()
                else:
                    self._buf[0] = b[take:]
            self._buffered -= got
            if got < n:
                self.underruns += 1
            self._consumed += n
            while len(self._marks) > 1 and self._marks[1][0] <= self._consumed:
                self._marks.popleft()
        return (np.clip(out, -1, 1) * 32767).astype(np.int16).tobytes()

    def heard(self) -> dict[str, Any] | None:
        """The track and position of the audio last pulled: the station's clock."""
        with self._lock:
            if not self._marks or self._marks[0][1] is None:
                return None
            frame, item, pos, playing = self._marks[0]
            if playing:
                pos += max(0, self._consumed - frame) / SR
            return {"item_id": item, "position": pos, "playing": playing}

    # --- queue changes ---------------------------------------------------------------

    def _on_event(self, ev: dict[str, Any]) -> None:
        if getattr(self._own, "busy", False):
            return  # the mixer's own auto-advance
        self._events.append(ev)
        self._dirty = True

    def _own_call(self, fn: Callable[..., None], *a: Any) -> None:
        self._own.busy = True
        try:
            fn(*a)
        finally:
            self._own.busy = False

    def _sync(self) -> None:
        events = [self._events.popleft() for _ in range(len(self._events))]
        self._dirty = False
        st = self._state = self.port.state()
        self.playing = bool(st["playing"])
        items = st["items"]
        item = items[st["current"]] if 0 <= st["current"] < len(items) else None
        if item is None:
            self.cur = self.blend = self._ready = self._prep = self._jump = None
            self.cur_item = None
            return
        accepted = {self.cur_item, self.blend.item_id if self.blend else None}
        position: float | None = None
        for ev in events:
            op = ev["op"]
            if (
                op == "go"
                and ev.get("keep")
                or op == "transport"
                and ev.get("action") == "seek"
            ):
                position = float(ev["position"])
            elif op in ("go", "set") or op == "ins" and ev.get("play"):
                position = float(st["position"])
                accepted = set()  # a restart of the same track too
        if self.cur is None and not self._jump:
            accepted = set()
        if item["item_id"] not in accepted or position is not None:
            if position is None:
                position = st["position"]
                if st["playing"]:
                    position += max(0.0, st["server_time"] - st["updated_at"])
            self._jump_to(item, position)
        elif not self.blend:
            self._replan()

    # --- loading and planning (worker thread) ------------------------------------------

    def _load(self, item: dict[str, Any]) -> Loaded:
        tid = item["track_id"]
        with self._cache_lock:
            if tid in self._cache:
                self._cache.move_to_end(tid)
                return self._cache[tid]
        src, analysis = self.sources.audio(item)
        full = decode(src)
        got = Loaded(full, mixplan.prep_track(len(full) / SR, analysis))
        with self._cache_lock:
            self._cache[tid] = got
            while len(self._cache) > 4:
                self._cache.popitem(last=False)
        return got

    def _jump_to(self, item: dict[str, Any], position: float) -> None:
        self._jump_n += 1
        self._prep = self._ready = None

        def work() -> tuple[Loaded, Voice]:
            loaded = self._load(item)
            return loaded, Voice.plain(loaded.full, position)

        self._jump = (self._jump_n, item["item_id"], self._pool.submit(work))

    def _settings(self, a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
        st = self._state
        own = st["mix"].get(f"{a['track_id']}>{b['track_id']}")
        return own or {**queue.DEFAULT_MIX_SETTINGS, "mode": st["default_mix"]}

    def _next_item(self) -> dict[str, Any] | None:
        st = self._state
        items = st["items"]
        ids = [i["item_id"] for i in items]
        if self.cur_item not in ids:
            return None
        j = ids.index(self.cur_item) + 1
        if j >= len(items):
            if not st["repeat"]:
                return None
            j = 0
        return items[j]

    def _replan(self) -> None:
        """Prepare the handover from the current track to the one after it."""
        nxt = self._next_item()
        cur = next(
            (i for i in self._state["items"] if i["item_id"] == self.cur_item), None
        )
        if nxt is None or cur is None or self.cur is None or self.cur_loaded is None:
            self._prep = self._ready = None
            return
        s = self._settings(cur, nxt)
        key = (cur["item_id"], nxt["item_id"], id(self.cur), tuple(sorted(s.items())))
        if self._prep and self._prep[0] == key:
            return
        self._ready = None
        voice, loaded = self.cur, self.cur_loaded

        def work() -> Prepared:
            b = self._load(nxt)
            p = mixplan.plan(loaded.track, b.track, s)
            vin = incoming(b.full, p)
            a0 = voice.out_at(p.mix_out)
            n = round(p.len * SR)
            swap = p.mode == "sync" and p.swap
            return Prepared(
                key, nxt["item_id"], b, p, vin,
                shelved(voice.arr[a0 : a0 + n]) if swap else None,
                shelved(vin.arr[:n]) if swap else None,
                a0,
            )  # fmt: skip

        self._prep = (key, self._pool.submit(work))

    # --- rendering -----------------------------------------------------------------------

    def render(self, n: int) -> np.ndarray:
        """The next *n* frames of the station (float32 stereo)."""
        if self._dirty or self._events:
            self._sync()
        self._poll()
        out = np.zeros((n, 2), np.float32)
        with self._lock:
            frame = self._rendered
            self._rendered += n
        item, pos = self._where()
        want = 1.0 if self.playing and (self.cur is not None or self.blend) else 0.0
        if self.playing or self._gain > 0:
            done = 0
            while done < n and (self.cur is not None or self.blend):
                done += self._segment(out, done, n - done)
        # A pause or a stop fades over this block; the clock does not move after it.
        out *= np.linspace(self._gain, want, n, dtype=np.float32)[:, None]
        self._gain = want
        with self._lock:
            self._marks.append((frame, item, pos, self.playing))
        return out

    def _where(self) -> tuple[str | None, float]:
        v = self.blend.voice if self.blend else self.cur
        item = self.blend.item_id if self.blend else self.cur_item
        return (item, v.src_at(v.idx)) if v else (None, 0.0)

    def _poll(self) -> None:
        if self._jump and self._jump[2].done():
            n, item_id, fut = self._jump
            self._jump = None
            if n == self._jump_n:
                try:
                    loaded, voice = fut.result()
                except Exception:
                    log.warning("cannot play the current track: skipping")
                    self._own_call(self.port.next)
                    self._dirty = True
                    return
                if self.cur is None or self._gain == 0:
                    self.cur, self.cur_loaded, self.cur_item = voice, loaded, item_id
                    self.blend = None
                    self._replan()
                else:  # cut over from what is playing
                    self._settle()
                    self.blend = Blend(voice, item_id, loaded, round(CUT * SR))
        if self._prep and self._prep[1] is not None and self._prep[1].done():
            key, fut = self._prep
            self._prep = (key, None)
            try:
                self._ready = fut.result()
            except Exception:
                log.warning("cannot prepare the next track: it will be skipped")

    def _settle(self) -> None:
        """Drop a blend in progress: whichever side is louder carries on."""
        b = self.blend
        if b is not None and b.k * 2 > b.n:
            self.cur, self.cur_loaded, self.cur_item = b.voice, b.loaded, b.item_id
        self.blend = self._ready = None

    def _segment(self, out: np.ndarray, at: int, room: int) -> int:
        b = self.blend
        if b is not None:
            m = min(room, b.n - b.k)
            out[at : at + m] = self._mix(b, m)
            if b.k >= b.n:
                self.cur, self.cur_loaded, self.cur_item = b.voice, b.loaded, b.item_id
                self.blend = None
                self._replan()
            return m
        cur = self.cur
        assert cur is not None
        if (ready := self._ready) is not None:
            mix_at = cur.out_at(ready.plan.mix_out)
            if cur.idx >= mix_at:
                self._begin(ready)
                return 0
            room = min(room, mix_at - cur.idx)
        if cur.idx >= len(cur.arr):
            waiting = self._prep is not None and self._prep[1] is not None
            if not waiting and self._ready is None:
                self._finished()
            return room  # waiting for the next track: silence
        m = min(room, len(cur.arr) - cur.idx)
        out[at : at + m] = cur.take(m)
        return m

    def _begin(self, p: Prepared) -> None:
        cur = self.cur
        assert cur is not None
        # The browser's own order of events: the queue moves on as the blend starts.
        self._own_call(self.port.next)
        self._own_call(self.port.seek, p.plan.start_off)
        self._state = self.port.state()
        a_sh = p.a_sh[max(0, cur.idx - p.a0) :] if p.a_sh is not None else None
        self.blend = Blend(
            p.voice, p.item_id, p.loaded, round(p.plan.len * SR), a_sh, p.b_sh
        )
        self._ready = self._prep = None

    def _finished(self) -> None:
        """The last track ended with nothing after it: the queue stops."""
        self._own_call(self.port.next)
        self.cur = None
        self._dirty = True

    def _mix(self, b: Blend, m: int) -> np.ndarray:
        cur = self.cur
        assert cur is not None
        pos = b.k + np.arange(m)
        t = pos / b.n
        a, i = cur.take(m), b.voice.take(m)
        if b.a_sh is not None and b.b_sh is not None:
            # The two basses never add: the incoming one is held down until the midpoint.
            dt = np.maximum(pos - b.n / 2, 0) / SR
            s = (1 - np.exp(-dt / SHELF_TAU))[:, None]
            a = a * (1 - s) + _pad(b.a_sh[b.k : b.k + m], m) * s
            i = _pad(b.b_sh[b.k : b.k + m], m) * (1 - s) + i * s
        b.k += m
        out = (
            a * np.cos(t * math.pi / 2)[:, None] + i * np.sin(t * math.pi / 2)[:, None]
        )
        return out.astype(np.float32)

    # --- offline use ----------------------------------------------------------------------

    def render_seconds(self, seconds: float) -> np.ndarray:
        """Render *seconds* without the thread, waiting for loads (tests, tools)."""
        self._dirty = True
        blocks = []
        for _ in range(math.ceil(seconds * SR / BLOCK)):
            if self._dirty or self._events:
                self._sync()
            for f in (self._jump and self._jump[2], self._prep and self._prep[1]):
                if f is not None:
                    f.exception()
            blocks.append(self.render(BLOCK))
        return np.concatenate(blocks)
