"""Tempo, beat grid and downbeat for every track in lib.json (adds bpm, beat0, bar0, bpmConf).

Onset strength = half-wave-rectified spectral flux (log magnitude) at 100 frames/s; tempo from a
comb over 70-200 BPM with a log-normal prior around 140 (so 87/174 resolves to the faster one for
d&b); phase by matching a pulse train; downbeat = the beat phase (of 4) with the most kick energy.
"""
import json, sys, subprocess, os
import numpy as np
from concurrent.futures import ProcessPoolExecutor

FF, LIB, ROOT = sys.argv[1:4]
SR, HOP, N = 11025, 110.25, 1024  # 100 frames per second


def decode(path):
    raw = subprocess.run([FF, '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 's16le', '-'], capture_output=True).stdout
    return np.frombuffer(raw[:len(raw) // 2 * 2], dtype=np.int16).astype(np.float32) / 32768


def analyse(path):
    x = decode(path)
    n = int((len(x) - N) / HOP)
    idx = (np.arange(n) * HOP).astype(int)[:, None] + np.arange(N)[None, :]
    spec = np.abs(np.fft.rfft(x[idx] * np.hanning(N), axis=1))
    logm = np.log1p(1000 * spec)
    flux = np.maximum(0, np.diff(logm, axis=0))
    freqs = np.fft.rfftfreq(N, 1 / SR)
    onset = flux.sum(1)
    kick = flux[:, (freqs > 30) & (freqs < 150)].sum(1)
    onset = onset - np.convolve(onset, np.ones(50) / 50, 'same')  # remove slow trend
    onset = np.maximum(onset, 0)
    fps = SR / HOP
    best, score = None, []
    for bpm in np.arange(70, 200.01, .1):
        p = 60 * fps / bpm
        lags = np.arange(1, 9) * p
        s = sum(np.dot(onset[:-int(l) - 1], onset[int(l):-1]) for l in lags) / len(lags)
        prior = np.exp(-.5 * (np.log2(bpm / 140) / .6) ** 2)
        score.append((s * prior, bpm))
    score.sort(reverse=True)
    bpm = score[0][1]
    conf = score[0][0] / (np.mean([s for s, _ in score]) + 1e-9)
    # refine: the coarse comb snaps to whole frames; sweep ±1.5 BPM in 0.02 steps with a sub-frame pulse
    # train over the whole track (all phases), and keep the tempo whose best phase lines up best
    t = np.arange(len(onset))
    def fit(b):
        p = 60 * fps / b; k = np.arange(int((len(onset) - p) / p))
        return max(np.interp(o + k * p, t, onset).sum() for o in np.arange(0, p, .5))
    cands = np.arange(bpm - 1.5, bpm + 1.501, .02)
    bpm = float(cands[int(np.argmax([fit(b) for b in cands]))])
    p = 60 * fps / bpm
    # phase: pulse train against the onset curve
    ph = np.arange(0, p, .5)
    k = np.arange(int((len(onset) - p) / p))
    val = [np.interp(o + k * p, t, onset).sum() for o in ph]
    beat0 = ph[int(np.argmax(val))] / fps
    # downbeat: which of the 4 beat phases carries the most kick
    k4 = np.arange(len(k) // 4)  # whole bars only, so no index runs past the end
    kk = [np.interp((beat0 + (b + 4 * k4) * 60 / bpm) * fps, t, kick).sum() for b in range(4)]
    bar0 = beat0 + int(np.argmax(kk)) * 60 / bpm
    return dict(bpm=round(float(bpm), 2), beat0=round(float(beat0), 3), bar0=round(float(bar0), 3), bpmConf=round(float(conf), 2))


lib = json.load(open(LIB))
paths = [os.path.join(ROOT, t['src']) for t in lib]
with ProcessPoolExecutor(max_workers=6) as ex:
    for t, r in zip(lib, ex.map(analyse, paths)):
        t.update(r)
        print(f"{r["bpm"]:7.2f}  conf {r['bpmConf']:5.2f}  bar0 {r['bar0']:6.2f}  {t['artist']} - {t['title']}", flush=True)
json.dump(lib, open(LIB, 'w'), separators=(',', ':'))
