from __future__ import annotations

import pytest

from sestudio.scraper import _YEAR_RE


def split_title(raw: str) -> tuple[str, int]:
    """Mirror the scraper: display title without the year, plus the year."""
    m = _YEAR_RE.search(raw)
    return _YEAR_RE.sub("", raw).strip(), (int(m.group(1)) if m else 0)


@pytest.mark.parametrize(
    ("raw", "title", "year"),
    [
        ("Dark (2017)", "Dark", 2017),
        ("One Piece - Saison 3", "One Piece - Saison 3", 0),
        # A year-like number inside the title is not the release year: only a
        # parenthesised year at the very end counts.
        ("Blade Runner 2049 (2017)", "Blade Runner 2049", 2017),
        ("Blade Runner 2049", "Blade Runner 2049", 0),
    ],
)
def test_year_is_extracted_and_stripped(raw, title, year):
    assert split_title(raw) == (title, year)
