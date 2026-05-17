"""
Domain resolver: fstream.top → live domain (e.g. fs03.lol).
Currently a pass-through; will auto-resolve in a future iteration.
"""

import httpx


FSTREAM_ENTRYPOINT = "https://fstream.top"


def resolve_domain(url: str) -> str:
    """Return the URL unchanged (pass-through until auto-resolution is implemented)."""
    return url


def resolve_live_domain() -> str:
    """Follow fstream.top redirects to find the current live domain."""
    with httpx.Client(follow_redirects=True, timeout=10) as client:
        resp = client.get(FSTREAM_ENTRYPOINT)
        # The landing page contains a link to the live domain
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(resp.text, "html.parser")
        link = soup.find("a", href=lambda h: h and h.startswith("https://") and "fstream" not in h)
        if link:
            import urllib.parse
            parsed = urllib.parse.urlparse(link["href"])
            return f"{parsed.scheme}://{parsed.netloc}"
        return str(resp.url).rstrip("/")
