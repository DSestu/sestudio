"""Build lib.json for the flow lab: the test instance's analysis, plus tonic and mode read locally.

    python prep.py fetch [--base https://localhost:8444]     # read-only; stdlib
    .venv/bin/python prep.py harmony <music folder>          # the app's modes.analyse on every file (needs ffmpeg, ~5 s per track)
"""

from __future__ import annotations

import argparse
import json
import ssl
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
LIB = HERE / "lib.json"


def fetch(base: str) -> None:
    ctx = ssl._create_unverified_context()  # the test instance's certificate is self-signed

    def get(path: str):
        with urllib.request.urlopen(base + path, context=ctx, timeout=30) as r:
            return json.load(r)

    old = {t["id"]: t for t in json.loads(LIB.read_text())} if LIB.exists() else {}
    files = [f for e in get("/api/downloaded") if e.get("kind") == "audio" for f in e["files"]]
    out = []
    for f in files:
        try:
            a = get(f"/api/music/tracks/{f['id']}/analysis")
        except Exception:
            continue  # not analysed yet
        en = a.get("energy") or []
        out.append({
            "id": f["id"], "title": f["title"], "file": f["path"], "dur": f.get("duration") or a.get("duration"),
            "bpm": a.get("bpm"), "camelot": a.get("camelot"), "keyConf": a.get("keyConf") or 0,
            "genre": a.get("genre"), "energy": sum(en) / len(en) if en else None,
            "harmony": a.get("harmony") or old.get(f["id"], {}).get("harmony"),  # keep a local reading
        })
    LIB.write_text(json.dumps(out, indent=1))
    print(f"{len(out)} analysed tracks of {len(files)} -> {LIB}")


def harmony(folder: str) -> None:
    sys.path.insert(0, str(HERE.parents[2] / "src"))
    from sestudio.music import analysis, modes  # the repo's own reading, so the lab matches the app

    lib = json.loads(LIB.read_text())
    for t in lib:
        if t.get("harmony"):
            continue
        t["harmony"] = modes.served(analysis.harmony(str(Path(folder) / t["file"])).get("harmony"), None)
        h = (t["harmony"] or {}).get("track") or {}
        print(f"{t['title'][:40]:<40} {h.get('tonic')} {h.get('mode')}{' ?' if h.get('unsure') else ''}", flush=True)
    LIB.write_text(json.dumps(lib, indent=1))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("fetch").add_argument("--base", default="https://localhost:8444")
    sub.add_parser("harmony").add_argument("folder")
    a = ap.parse_args()
    fetch(a.base) if a.cmd == "fetch" else harmony(a.folder)
