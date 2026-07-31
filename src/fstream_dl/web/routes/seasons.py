from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException

from fstream_dl.http_client import new_client
from fstream_dl.scraper import HEADERS, _fetch_film_available_langs, fetch_page, fetch_season

router = APIRouter()


@router.get("/season")
async def get_season(url: str, lang: str = "vf") -> dict[str, Any]:
    try:
        season_num, episodes, is_film = await asyncio.to_thread(fetch_page, url, lang)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if is_film:
        available_langs = await asyncio.to_thread(_fetch_film_available_langs, url)
    else:
        available_langs = await asyncio.to_thread(_fetch_available_langs, url)

    return {
        "season": season_num,
        "is_film": is_film,
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
    with new_client(headers=HEADERS) as client:
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
        if eps_resp.status_code == 404:
            eps_resp = client.get(
                f"{base}/engine/ajax/manga_episodes_api.php?id={news_id}",
                headers={"Referer": url, "X-Requested-With": "XMLHttpRequest"},
            )
        eps_resp.raise_for_status()
    data: dict[str, object] = eps_resp.json()
    # Only report a language that actually has episodes: some titles list a lang
    # key (e.g. "vf") with an empty map, which otherwise makes the UI think the
    # language exists and show an empty season instead of switching to a real one.
    lang_keys = [
        k for k, v in data.items()
        if k not in ("info", "alt_titles") and isinstance(v, dict) and v
    ]
    return sorted(lang_keys)
