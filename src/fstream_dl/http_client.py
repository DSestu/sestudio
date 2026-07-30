from __future__ import annotations

from typing import Any

import httpx

# The upstream streaming domains routinely serve expired or mismatched TLS
# certificates (e.g. fstream.top presenting a cert for www.fstream.info that
# expired 2026-07-26). This is a best-effort scraper, not a security boundary:
# no credentials or secrets are ever sent to these hosts, so certificate
# verification is disabled to keep the app usable when their certs lapse.
VERIFY_TLS = False


def new_client(**kwargs: Any) -> httpx.Client:
    """Create an httpx.Client with scraper-friendly defaults (TLS verify off)."""
    kwargs.setdefault("timeout", 15)
    kwargs.setdefault("follow_redirects", True)
    kwargs.setdefault("verify", VERIFY_TLS)
    return httpx.Client(**kwargs)
