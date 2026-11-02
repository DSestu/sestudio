import pytest

from sestudio.scraper import _unslash


@pytest.mark.parametrize(
    ("raw", "clean"),
    [
        ("DEATH &amp;amp; STRAWBERRY", "DEATH & STRAWBERRY"),
        ("Tom &amp; Jerry", "Tom & Jerry"),
        ("l\\'ombre", "l'ombre"),
        ("Plain title", "Plain title"),
    ],
)
def test_unslash_decodes_entities_once_or_twice(raw, clean):
    assert _unslash(raw) == clean
