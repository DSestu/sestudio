from __future__ import annotations

from abc import ABC, abstractmethod

from fstream_dl.models import StreamSource


class ProviderError(Exception):
    pass


class StreamProvider(ABC):
    @abstractmethod
    def get_stream_url(self, embed_url: str) -> StreamSource:
        """Resolve an embed page URL to a direct stream URL."""
