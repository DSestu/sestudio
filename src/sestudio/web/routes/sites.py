from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from sestudio.config import load_config

router = APIRouter()


@router.get("/sites")
async def list_sites(request: Request) -> list[dict[str, Any]]:
    """The registered content sites, so the UI can offer one toggle per source."""
    disabled = set(load_config().disabled_sites)
    return [
        {
            "id": site.id,
            "display_name": site.display_name,
            "is_anime": site.is_anime,
            "enabled": site.id not in disabled,
        }
        for site in request.app.state.sites.values()
    ]
