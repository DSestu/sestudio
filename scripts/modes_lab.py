"""Lab gate for mode detection (harmony master plan E0.1): read every track of a folder, judge by ear.

Prints note set, tonic, mode and confidence per track, and writes a JSON and a
standalone judging page (play the track with a tonic drone, play the scale,
mark Right / Wrong). Reads the audio only; nothing on the server changes.

uv run python scripts/modes_lab.py "/mnt/r/Musique/Android/neuro soundcloud" --out lab/modes
"""

from __future__ import annotations

import argparse
import json
import re
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any

from sestudio.music import analysis, keynet, modes

AUDIO = {".m4a", ".mp3", ".opus", ".flac", ".wav", ".ogg"}
PAGE = Path(__file__).with_name("modes_lab.html")


def one(path: Path) -> dict[str, Any]:
    x = analysis.decode(str(path), keynet.RATE)
    return {"file": path.name, "path": str(path), **(modes.analyse(x) or {})}


def windows_url(path: str) -> str:
    """file:// URL the Windows browser can open, from a WSL /mnt/<drive>/ path."""
    m = re.match(r"^/mnt/([a-z])/(.*)$", path)
    p = f"{m[1].upper()}:/{m[2]}" if m else path
    return "file:///" + p.replace("%", "%25").replace("#", "%23").lstrip("/")


def row(r: dict[str, Any]) -> str:
    t = r.get("track")
    if not t:
        return f"{'-':24} {r['file']}"
    flag = "?" if t["unsure"] else " "
    edge = " -> ".join(
        f"{e} {r[e]['label']}"
        for e in ("intro", "outro")
        if e in r and r[e]["label"] != t["label"]
    )
    return (
        f"{t['label']:22}{flag} vs {t['alt']:22} contrast {t['contrast']:.2f} "
        f"tonic {t['tonic_share']:.2f}  S-KEY {t['skey']:9} {r['file'][:44]}"
        f"{'  [' + edge + ']' if edge else ''}"
    )


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("folder", type=Path)
    ap.add_argument(
        "--out",
        type=Path,
        default=Path("lab/modes"),
        help="writes <out>.json and <out>.html",
    )
    ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--limit", type=int, default=0, help="first N files only")
    a = ap.parse_args()
    files = sorted(p for p in a.folder.iterdir() if p.suffix.lower() in AUDIO)
    files = files[: a.limit] if a.limit else files
    with ProcessPoolExecutor(a.jobs) as pool:
        results = list(pool.map(one, files))
    for r in results:
        print(row(r))
    for r in results:
        r["url"] = windows_url(r.pop("path"))
    a.out.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(results, indent=1, ensure_ascii=False)
    a.out.with_suffix(".json").write_text(data, encoding="utf-8")
    page = (
        PAGE.read_text(encoding="utf-8")
        .replace("/*DATA*/[]", data)
        .replace("/*SCALES*/{}", json.dumps(modes.SCALES))
    )
    a.out.with_suffix(".html").write_text(page, encoding="utf-8")
    unsure = sum(1 for r in results if r.get("track", {}).get("unsure"))
    print(
        f"\n{len(results)} tracks, {unsure} unsure. Wrote {a.out.with_suffix('.html')}"
    )


if __name__ == "__main__":
    main()
