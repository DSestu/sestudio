import re

import httpx

from fstream_dl.models import StreamSource
from fstream_dl.providers.base import ProviderError, StreamProvider

REFERER = "https://uqload.is/"
MP4_RE = re.compile(r'(https://strm[^"\'<>\s]+/v\.mp4)')

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    "Referer": REFERER,
}


class UqloadProvider(StreamProvider):
    def get_stream_url(self, embed_url: str) -> StreamSource:
        with httpx.Client(headers=HEADERS, timeout=15, follow_redirects=True) as client:
            resp = client.get(embed_url)
            resp.raise_for_status()

        match = MP4_RE.search(resp.text)
        if not match:
            raise ProviderError(f"No mp4 URL found in Uqload embed: {embed_url}")

        return StreamSource(url=match.group(1), referer=REFERER, provider="uqload")
