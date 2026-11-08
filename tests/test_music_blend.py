from __future__ import annotations

import json
from pathlib import Path

import pytest

from sestudio.music.blend import blend

CASES = json.loads((Path(__file__).parent / "fixtures" / "blend.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_blend_matches_the_shared_fixture(case):
    # frontend/src/blend.test.ts reads the same file: both sides give the same answer.
    assert blend(case["a"], case["b"], **case["opts"]) == case["expect"]


def _by(name: str) -> dict:
    return next(c for c in CASES if c["name"] == name)


def test_close_tracks_blend_well_and_nothing_blocks_at_prefer():
    assert _by("close in every way")["expect"]["score"] > 0.95
    assert not any(
        c["expect"]["blocked"] for c in CASES if not c["opts"].get("settings")
    )


def test_the_lean_moves_the_best_energy_step():
    down = _by("step down against a lift")["expect"]["parts"]["energy"]
    assert _by("ease wants the step down")["expect"]["parts"]["energy"] > down


def test_must_blocks_only_big_jumps_and_mismatches():
    for name in (
        "big energy jump blocked by must",
        "tempo jump blocked by must",
        "genre block must, mismatch",
        "colour must, mismatch",
    ):
        assert _by(name)["expect"]["blocked"], name
    a, b = _by("close in every way")["a"], _by("close in every way")["b"]
    assert not blend(a, b, settings={"energy": "must", "tempo": "must"})["blocked"]


def test_ignore_drops_the_layer():
    assert _by("genre ignored")["expect"]["parts"]["genre"] is None
