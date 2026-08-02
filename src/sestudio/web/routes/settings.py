from __future__ import annotations

import dataclasses
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from sestudio.config import load_config, save_config

router = APIRouter()


class SettingsBody(BaseModel):
    output_root: str | None = None
    lang: str | None = None
    download_destination: str | None = None


@router.get("/settings")
async def get_settings() -> dict[str, Any]:
    return dataclasses.asdict(load_config())


@router.put("/settings")
async def put_settings(body: SettingsBody) -> dict[str, Any]:
    cfg = load_config()
    if body.output_root is not None:
        cfg.output_root = body.output_root
    if body.lang is not None and body.lang in ("vf", "vostfr", "vo"):
        cfg.lang = body.lang
    if body.download_destination is not None and body.download_destination in (
        "server",
        "device",
    ):
        cfg.download_destination = body.download_destination
    save_config(cfg)
    return dataclasses.asdict(cfg)
