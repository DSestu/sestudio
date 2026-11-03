from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


@pytest.fixture(autouse=True)
def _no_music_analysis(monkeypatch):
    """Listings kick the background analysis; tests of other things must not run it."""
    monkeypatch.setenv("SESTUDIO_MUSIC_ANALYSIS", "0")
