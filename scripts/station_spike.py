"""Measure the station renderer (SPEC-music §7): run against a sestudio that is already playing a queue.

uv run --extra station python scripts/station_spike.py http://127.0.0.1:8090/?tv --seconds 120 --height 720
"""

import argparse
import asyncio
import json
from pathlib import Path

from sestudio.music.station_spike import run

ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument(
    "url", help="the sestudio page with ?tv, e.g. http://127.0.0.1:8090/?tv"
)
ap.add_argument("--seconds", type=float, default=120)
ap.add_argument("--height", type=int, default=720, choices=[540, 720, 1080])
ap.add_argument("--fps", type=int, default=30)
ap.add_argument("--method", choices=["screencast", "screenshot"], default="screencast")
ap.add_argument(
    "--channel", help="system browser: chrome, msedge (default: bundled Chromium)"
)
ap.add_argument(
    "--hls", action="store_true", help="write an HLS playlist instead of one file"
)
ap.add_argument("--browser-path", help="explicit browser executable")
ap.add_argument(
    "--dsf",
    type=float,
    default=1.0,
    help="device scale factor: 0.667 renders 720p natively",
)
ap.add_argument(
    "--css", default="", help="CSS injected into the page, to find what is expensive"
)
ap.add_argument("--preset", default="veryfast", help="x264 preset")
ap.add_argument("--out", type=Path, default=Path("station_spike.mp4"))
ap.add_argument(
    "--chromium-arg",
    action="append",
    default=[],
    help="extra launch flag, e.g. --use-gl=swiftshader",
)
a = ap.parse_args()

print(
    json.dumps(
        asyncio.run(
            run(
                a.url,
                a.out,
                a.seconds,
                a.height,
                a.fps,
                a.method,
                a.channel,
                a.browser_path,
                dsf=a.dsf,
                css=a.css,
                hls=a.hls,
                preset=a.preset,
                extra_args=a.chromium_arg,
            )
        ),
        indent=2,
    )
)
