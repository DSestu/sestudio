from __future__ import annotations

import logging
import urllib.parse

from bs4 import BeautifulSoup

from fstream_dl.http_client import new_client

logger = logging.getLogger(__name__)

FSTREAM_ENTRYPOINT = "https://fstream.top"


def resolve_live_domain() -> str:
    """Follow fstream.top redirects and extract the current live domain from the landing page."""
    logger.debug("Resolving live domain from %s", FSTREAM_ENTRYPOINT)
    with new_client(timeout=10) as client:
        resp = client.get(FSTREAM_ENTRYPOINT)
        resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")
    link = soup.find("a", href=lambda h: h and h.startswith("https://") and "fstream" not in h)
    if link:
        parsed = urllib.parse.urlparse(str(link["href"]))
        live = f"{parsed.scheme}://{parsed.netloc}"
        logger.debug("Resolved live domain: %s", live)
        return live

    live = str(resp.url).rstrip("/")
    logger.debug("Resolved via redirect: %s", live)
    return live


def rebase_url(url: str, live_domain: str) -> str:
    """Replace the host portion of *url* with *live_domain*."""
    parsed = urllib.parse.urlparse(url)
    live_parsed = urllib.parse.urlparse(live_domain)
    rebased = parsed._replace(scheme=live_parsed.scheme, netloc=live_parsed.netloc)
    return urllib.parse.urlunparse(rebased)
