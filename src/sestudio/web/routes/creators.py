from __future__ import annotations

import asyncio
from typing import Any

import csv
import io
import re

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from sestudio import library
from sestudio.sites.base import SiteError
from sestudio.sites.creators import _TWITCH_LIVE, _YtDlpSite, twitch_gql, twitch_live
from sestudio.watchers.models import DEFAULT_INTERVALS, validate_config
from sestudio.watchers.poller import initial_next_poll

router = APIRouter()


def _creator_site(request: Request, url: str) -> _YtDlpSite:
    for site in request.app.state.sites.values():
        if isinstance(site, _YtDlpSite) and site.owns_url(url):
            return site
    raise HTTPException(status_code=400, detail="Not a YouTube or Twitch link")


@router.get("/link")
async def get_link(url: str, request: Request) -> dict[str, Any]:
    """What a pasted YouTube or Twitch link points at, for its card."""
    site = _creator_site(request, url)
    try:
        return await asyncio.to_thread(site.video, url)
    except SiteError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/channel")
async def get_channel(url: str, request: Request) -> dict[str, Any]:
    """A YouTube or Twitch channel and its latest videos."""
    site = _creator_site(request, url)
    try:
        return await asyncio.to_thread(site.channel, url)
    except SiteError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/live")
async def get_live() -> list[dict[str, Any]]:
    """The followed channels live now (Twitch; YouTube has no cheap live check)."""
    logins = [
        str(w["config"].get("channel_url") or "").rstrip("/").rsplit("/", 1)[-1].lower()
        for w in await asyncio.to_thread(library.watcher_list)
        if w["kind"] == "channel" and w["config"].get("source") == "twitch"
    ]
    try:
        return await asyncio.to_thread(
            twitch_live, [login for login in logins if login]
        )
    except SiteError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


class ImportBody(BaseModel):
    # Google Takeout's subscriptions.csv, as text (it is a few kB at most).
    youtube_csv: str = Field(default="", max_length=2_000_000)
    # Twitch names or channel links, one per line (or separated by spaces/commas).
    twitch: str = Field(default="", max_length=100_000)


def youtube_subscriptions(text: str) -> list[tuple[str, str]]:
    """(channel id, title) for each row of a Takeout subscriptions.csv."""
    rows = csv.reader(io.StringIO(text.lstrip("\ufeff")))
    out = []
    for row in rows:
        if row and re.fullmatch(r"UC[\w-]{22}", row[0].strip()):
            out.append((row[0].strip(), row[2].strip() if len(row) > 2 else ""))
    return out


def twitch_logins(text: str) -> list[str]:
    """Twitch logins from names or twitch.tv links, deduplicated, in order."""
    logins = []
    for token in re.split(r"[\s,;]+", text):
        login = token.strip().rstrip("/").rsplit("/", 1)[-1].lstrip("@").lower()
        if re.fullmatch(r"\w{3,25}", login) and login not in logins:
            logins.append(login)
    return logins


@router.post("/follows/import")
async def import_follows(body: ImportBody) -> dict[str, Any]:
    """Follow every channel in a Takeout CSV and/or a list of Twitch names,
    skipping the ones already followed."""
    followed = {
        w["config"].get("channel_url")
        for w in await asyncio.to_thread(library.watcher_list)
        if w["kind"] == "channel"
    }
    wanted: list[dict[str, str]] = [
        {
            "channel_url": f"https://www.youtube.com/channel/{cid}",
            "source": "youtube",
            "name": title,
        }
        for cid, title in youtube_subscriptions(body.youtube_csv)
    ]
    unknown: list[str] = []
    logins = twitch_logins(body.twitch)
    if logins:
        try:
            users = await asyncio.to_thread(
                lambda: (
                    twitch_gql(_TWITCH_LIVE, {"logins": logins[:100]}).get("users")
                    or []
                )
            )
        except SiteError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        found = {u["login"]: u for u in users if u}
        unknown = [login for login in logins if login not in found]
        wanted += [
            {
                "channel_url": f"https://www.twitch.tv/{u['login']}",
                "source": "twitch",
                "name": u.get("displayName") or u["login"],
                "avatar": u.get("profileImageURL") or "",
            }
            for u in found.values()
        ]

    added = 0
    for config in wanted:
        if config["channel_url"] in followed:
            continue
        followed.add(config["channel_url"])
        await asyncio.to_thread(
            library.watcher_create,
            "channel",
            validate_config("channel", config),
            label=config["name"],
            interval_seconds=DEFAULT_INTERVALS["channel"],
            next_poll_at=initial_next_poll(),
        )
        added += 1
    return {"added": added, "skipped": len(wanted) - added, "unknown": unknown}
