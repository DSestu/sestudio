"""Whole-library analysis for the prototype: duration, loudness envelope, hue, 8 bands (normalised across the library)."""
import json, sys, subprocess, array, math, os, re
from concurrent.futures import ProcessPoolExecutor
FF, SRC, OUT = sys.argv[1:4]
CENTERS = [60, 120, 250, 500, 1000, 2000, 4000]
FILTERS = [f"bandpass=f={c}:width_type=o:w=1" for c in CENTERS] + ["highpass=f=7000"]
OVERRIDES = {"Sidewinder - Mefjus & Camo & Krooked": ("Mefjus & Camo & Krooked", "Sidewinder")}

def decode(path, rate, af=None):
    cmd = [FF, '-v', 'error', '-i', path, '-ac', '1', '-ar', str(rate)] + (['-af', af] if af else []) + ['-f', 's16le', '-']
    a = array.array('h'); raw = subprocess.run(cmd, capture_output=True).stdout; a.frombytes(raw[:len(raw) // 2 * 2]); return a

def job(args):
    f, kind, idx = args
    p = os.path.join(SRC, f)
    if kind == "base":
        a = decode(p, 4000)
        env = [math.sqrt(sum(x * x for x in a[b:b + 400:4]) / max(len(a[b:b + 400:4]), 1)) for b in range(0, len(a), 400)]
        zc = sum(1 for i in range(1, len(a), 7) if (a[i - 1] < 0) != (a[i] < 0))
        return f, kind, idx, dict(dur=len(a) / 4000, env=env, zcr=zc / max(len(a) / 7, 1))
    a = decode(p, 16000, FILTERS[idx])
    return f, kind, idx, [math.sqrt(sum(x * x for x in a[b:b + 1600:8]) / max(len(a[b:b + 1600:8]), 1)) for b in range(0, len(a), 1600)]

files = sorted(f for f in os.listdir(SRC) if f.endswith(('.m4a', '.opus', '.mp3', '.flac')))
jobs = [(f, "base", 0) for f in files] + [(f, "band", i) for f in files for i in range(8)]
res = {f: {"bands": [None] * 8} for f in files}
with ProcessPoolExecutor(max_workers=max(2, (os.cpu_count() or 4))) as ex:
    for n, (f, kind, idx, val) in enumerate(ex.map(job, jobs), 1):
        if kind == "base": res[f].update(val)
        else: res[f]["bands"][idx] = val
        if n % 40 == 0: print(n, "/", len(jobs), flush=True)
zs = sorted(r["zcr"] for r in res.values())
norm = []
for i in range(8):
    allv = sorted(v for r in res.values() for v in r["bands"][i]); norm.append(allv[int(len(allv) * .98)] or 1)
lib = []
for f in files:
    r = res[f]; stem = re.sub(r'\s*\[\d+\]$', '', os.path.splitext(f)[0]).strip()
    artist, title = OVERRIDES.get(stem) or ((stem.split(' - ', 1)) if ' - ' in stem else ("neuro soundcloud", stem))
    m = sorted(r["env"])[int(len(r["env"]) * .98)] or 1
    lib.append(dict(id=f, src="lib/" + f, title=title.strip(), artist=artist.strip(), folder="neuro soundcloud", dur=round(r["dur"], 2),
                    hue=round(195 + zs.index(r["zcr"]) / (len(zs) - 1) * 125), env=[round(min(e / m, 1), 2) for e in r["env"]],
                    bands=[[round(min(v / norm[i], 1), 2) for v in r["bands"][i]] for i in range(8)]))
json.dump(lib, open(f"{OUT}/lib.json", "w"))
print("done", len(lib), "tracks", os.path.getsize(f"{OUT}/lib.json") // 1024, "KB")
