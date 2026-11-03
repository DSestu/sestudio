"""Eight frequency bands per track, 10 values per second, normalised across all tracks per band."""
import json, sys, subprocess, array, math
FF, ROOT = sys.argv[1:3]
tracks = json.load(open(f'{ROOT}/tracks.json'))
CENTERS = [60, 120, 250, 500, 1000, 2000, 4000]
FILTERS = [f"bandpass=f={c}:width_type=o:w=1" for c in CENTERS] + ["highpass=f=7000"]
raw_bands = {}
for t in tracks:
    bands = []
    for f in FILTERS:
        raw = subprocess.run([FF, '-v', 'error', '-i', f"{ROOT}/{t['src']}", '-ac', '1', '-ar', '16000', '-af', f, '-f', 's16le', '-'], capture_output=True).stdout
        a = array.array('h'); a.frombytes(raw[:len(raw) // 2 * 2])
        bands.append([math.sqrt(sum(x * x for x in a[b:b + 1600:8]) / max(len(a[b:b + 1600:8]), 1)) for b in range(0, len(a), 1600)])
    raw_bands[t['title']] = bands
    print(t['title'], len(bands[0]))
norm = []
for i in range(8):
    allv = sorted(v for b in raw_bands.values() for v in b[i])
    norm.append(allv[int(len(allv) * .98)] or 1)
out = {k: [[round(min(v / norm[i], 1), 2) for v in b[i]] for i in range(8)] for k, b in raw_bands.items()}
json.dump(out, open(f'{ROOT}/bands8.json', 'w'))
