"""Storages as the client sees them (SPEC-storage): the Media switcher reads this."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter

from sestudio import storage

router = APIRouter()


def public(s: dict[str, Any]) -> dict[str, Any]:
    """A storage without its secrets: another server's token never leaves this one."""
    return {k: v for k, v in s.items() if k != "token"}


@router.get("/storages")
async def list_storages() -> list[dict[str, Any]]:
    def rows() -> list[dict[str, Any]]:
        return [public(s) | storage.state(s) for s in storage.all_storages()]

    return await asyncio.to_thread(rows)
