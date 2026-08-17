"""Sidecar subtitle extraction, shared by the vidzy-family embeds.

vidzy and premium (fsvid.lol) run the same video.js player, and it declares soft
subs in one of two places:

* a `<track kind="captions" src="..." srclang="..." label="...">` element, or
* a `player.loadTracks([{kind:'subtitles', srclang:'fre', label:'French',
  src: (function(u){...})('https://vidzy.org/srtproxy/<code>_fre.vtt?...')}])`
  call wired to `loadeddata`.

The `loadTracks` form wraps the URL in an IIFE that rewrites it to the embed's
own origin so the browser fetches it same-origin. We want the *argument*, not the
rewritten result: the original is absolute and reachable server-side, and the
proxy supplies the Referer that rewriting was standing in for.

Both hosts also ship an "upload your own SRT" feature whose placeholder track
points at an empty file (`/srt/empty.vtt`, usually `srclang="th"`, label
"Upload SRT"). It has no cues, so it is dropped rather than surfaced as a
subtitle the user can select and find blank.
"""

from __future__ import annotations

import html
import logging
import re
from urllib.parse import urljoin, urlsplit

from sestudio.models import Subtitle

logger = logging.getLogger(__name__)

# The whole `loadTracks([...])` argument list; lazy so it stops at the first `])`.
_LOAD_TRACKS_RE = re.compile(r"loadTracks\s*\(\s*\[(?P<body>.{0,4000}?)\]\s*\)", re.S)

_HTML_TRACK_RE = re.compile(r"<track\b(?P<attrs>[^>]*)>", re.I)
_ATTR_RE = re.compile(r"""(\w[\w-]*)\s*=\s*["']([^"']*)["']""")

_KEY_RE = re.compile(
    r"""\b(kind|srclang|label|default)\s*:\s*(?:["']([^"']*)["']|(\w+))"""
)
# A quoted subtitle URL anywhere in an entry. `.vtt`/`.srt` may carry a query.
_SUB_URL_RE = re.compile(r"""["']([^"']+\.(?:vtt|srt)(?:\?[^"']*)?)["']""", re.I)

# Track kinds that carry displayable text.
_TEXT_KINDS = {"subtitles", "captions"}


def _is_placeholder(url: str) -> bool:
    """True for the "upload your own SRT" stub, which resolves to an empty file."""
    return urlsplit(url).path.rsplit("/", 1)[-1].lower() in {"empty.vtt", "empty.srt"}


def _build(url: str, attrs: dict[str, str], base_url: str) -> Subtitle | None:
    kind = (attrs.get("kind") or "subtitles").lower()
    if kind not in _TEXT_KINDS:
        return None
    absolute = urljoin(base_url, html.unescape(url))
    if _is_placeholder(absolute):
        return None
    lang = attrs.get("srclang", "")
    # JS writes `default: true`; HTML writes a boolean attribute, which reaches
    # us as an empty value when it is spelled `default=""`.
    is_default = "default" in attrs and attrs["default"].lower() != "false"
    return Subtitle(
        url=absolute,
        lang=lang,
        label=attrs.get("label") or lang or "Subtitles",
        default=is_default,
    )


def _from_load_tracks(page: str, base_url: str) -> list[Subtitle]:
    """Parse `loadTracks([...])` entries, anchored on the subtitle URLs.

    The entries are *not* split on braces up front: the `src` value is an IIFE
    whose body nests several levels deep, which no fixed-depth brace match
    survives. Every entry holds exactly one subtitle URL, so each entry is bounded
    by the first `}` *after* its URL — the IIFE's braces all sit before it, and
    what follows the URL is only the closing paren and any trailing keys
    (`default: true`). Widening the window to the next URL instead would let the
    following entry's `srclang`/`label` overwrite this one's.
    """
    found: list[Subtitle] = []
    for call in _LOAD_TRACKS_RE.finditer(page):
        body = call.group("body")
        start = 0
        for url_match in _SUB_URL_RE.finditer(body):
            close = body.find("}", url_match.end())
            end = len(body) if close < 0 else close
            attrs = {
                key: (quoted if quoted else bare)
                for key, quoted, bare in _KEY_RE.findall(body[start:end])
            }
            sub = _build(url_match.group(1), attrs, base_url)
            if sub:
                found.append(sub)
            start = end
    return found


def _from_html_tracks(page: str, base_url: str) -> list[Subtitle]:
    found: list[Subtitle] = []
    for track in _HTML_TRACK_RE.finditer(page):
        attrs = {k.lower(): v for k, v in _ATTR_RE.findall(track.group("attrs"))}
        src = attrs.get("src")
        if not src:
            continue
        sub = _build(src, attrs, base_url)
        if sub:
            found.append(sub)
    return found


def extract(page: str, base_url: str) -> list[Subtitle]:
    """Collect every real sidecar subtitle declared by a vidzy-family embed.

    *page* is the embed HTML (unpacked, if it was packed); *base_url* the URL it
    was served from, for resolving relative `src` values. Returns an empty list
    when the host serves none — the common case, since most releases are hardsub.
    Duplicates across the two declaration styles are collapsed by URL.
    """
    found = _from_load_tracks(page, base_url) + _from_html_tracks(page, base_url)

    unique: list[Subtitle] = []
    seen: set[str] = set()
    for sub in found:
        if sub.url not in seen:
            seen.add(sub.url)
            unique.append(sub)

    if unique:
        logger.debug(
            "Extracted %d subtitle track(s): %s",
            len(unique),
            ", ".join(f"{s.label} ({s.lang})" for s in unique),
        )
    return unique
