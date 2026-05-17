from __future__ import annotations

import asyncio
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException

from fstream_dl.scraper import HEADERS, fetch_season

router = APIRouter()


@router.get("/season")
async def get_season(url: str, lang: str = "vf") -> dict[str, Any]:
    try:
        season_num, episodes = await asyncio.to_thread(fetch_season, url, lang)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    # Determine available languages by fetching the eps JSON keys
    available_langs = await asyncio.to_thread(_fetch_available_langs, url)

    return {
        "season": season_num,
        "available_langs": available_langs,
        "episodes": [
            {
                "number": ep.number,
                "title": ep.title,
                "filename": ep.filename,
                "providers": list(ep.embed_urls.keys()),
                "embed_urls": ep.embed_urls,
            }
            for ep in episodes
        ],
    }


def _fetch_available_langs(url: str) -> list[str]:
    """Return the language keys present in the eps JSON for this season page."""
    from bs4 import BeautifulSoup
    with httpx.Client(headers=HEADERS, timeout=15, follow_redirects=True) as client:
        page = client.get(url)
        page.raise_for_status()
        soup = BeautifulSoup(page.text, "html.parser")
        config = soup.find(id="serie-config")
        if not config:
            return []
        news_id = config.get("data-news-id", "")
        if not news_id:
            return []
        base = "/".join(str(page.url).split("/")[:3])
        eps_resp = client.get(f"{base}/data/eps_{news_id}.txt", headers={"Referer": url})
        eps_resp.raise_for_status()
    data: dict[str, object] = eps_resp.json()
    lang_keys = [k for k in data if k not in ("info",) and isinstance(data[k], dict)]
    return sorted(lang_keys)
