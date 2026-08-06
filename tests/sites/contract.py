"""Generic assertions every ContentSite implementation must satisfy.

A site's test module subclasses SiteContractMixin, provides a ``site`` fixture
and a ``searchable_query`` fixture (with whatever HTTP mocking the site needs),
and inherits these tests for free.
"""

from __future__ import annotations

import pytest

from sestudio.sites import ContentSite, SiteError, StreamCandidate


class SiteContractMixin:
    def test_search_stamps_source(self, site: ContentSite, searchable_query: str):
        cards = site.search(searchable_query)
        assert cards, "expected at least one search result"
        assert all(card.source == site.id for card in cards)

    def test_stream_candidates_respect_provider_order(self, site: ContentSite):
        order = site.provider_order()
        embeds = {p: f"https://example.com/{p}" for p in reversed(order)}
        embeds["unknown-host"] = "https://example.com/unknown"
        candidates = site.stream_candidates(embeds)
        assert [c.provider for c in candidates[: len(order)]] == list(order)
        # Unlisted providers are appended, never dropped.
        assert candidates[-1].provider == "unknown-host"

    def test_resolve_candidate_without_resolver_raises(self, site: ContentSite):
        cand = StreamCandidate("unknown-host", "https://example.com/x")
        with pytest.raises(SiteError):
            site.resolve_candidate(cand, {})
