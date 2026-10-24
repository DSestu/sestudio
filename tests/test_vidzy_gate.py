"""Vidzy's gate key: without it the CDN serves only a stream's first 90 s."""

from __future__ import annotations

import httpx

from sestudio.providers import vidzy

PAGE = "<script>fetch('https://v6.vidzy.cc/gate.php?'+d,{mode:'cors'})</script>"
STREAM = "https://u14.vidzy.cc/hls2/x/master.m3u8?t=abc&s=1"


class _Client:
    def __init__(self, answer):
        self.answer, self.asked = answer, []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, url, params=None, headers=None):
        self.asked.append((url, params))
        if isinstance(self.answer, Exception):
            raise self.answer
        return httpx.Response(200, json=self.answer)


def test_the_key_the_gate_hands_out_is_added_to_the_stream(monkeypatch):
    client = _Client({"ok": 1, "gk": "k/ey.1792853482.86400"})
    monkeypatch.setattr(vidzy, "new_client", lambda **kw: client)

    assert vidzy._with_gate_key(PAGE, STREAM) == STREAM + "&gk=k%2Fey.1792853482.86400"
    url, params = client.asked[0]
    assert url == "https://v6.vidzy.cc/gate.php"
    assert params["v"] == "p1" and params["ft"]


def test_no_gate_or_no_answer_leaves_the_stream_as_it_was(monkeypatch):
    monkeypatch.setattr(vidzy, "new_client", lambda **kw: _Client({"ok": 0}))
    assert vidzy._with_gate_key(PAGE, STREAM) == STREAM
    assert vidzy._with_gate_key("<html>no gate</html>", STREAM) == STREAM
    down = _Client(httpx.ConnectError("refused"))
    monkeypatch.setattr(vidzy, "new_client", lambda **kw: down)
    assert vidzy._with_gate_key(PAGE, STREAM) == STREAM
