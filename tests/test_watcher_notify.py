from __future__ import annotations

import pytest

from sestudio.config import AppConfig
from sestudio.watchers import notify


class Recorder:
    """A notifier double: always enabled, records what it was asked to send."""

    id = "recorder"

    def __init__(self, boom: bool = False) -> None:
        self.sent: list[str] = []
        self.boom = boom

    def enabled(self, cfg: AppConfig) -> bool:
        return True

    def send(self, summary: str, cfg: AppConfig) -> None:
        if self.boom:
            raise RuntimeError("provider down")
        self.sent.append(summary)


def _event(title: str, subtitle: str = "", kind: str = "new_item") -> dict:
    return {"event_type": kind, "title": title, "subtitle": subtitle}


@pytest.fixture()
def cfg():
    return AppConfig(
        notifications_enabled=True,
        callmebot_phone="33612345678",
        callmebot_apikey="secret-key",
    )


def test_one_message_per_watcher_however_many_items(cfg):
    """CallMeBot throttles hard, and a season landing at once would otherwise fan
    out a message per episode."""
    rec = Recorder()
    events = [_event(f"Ep {n}", f"S01E{n:02d} · VF") for n in range(1, 25)]

    assert notify.dispatch("Naruto", events, cfg=cfg, notifiers=[rec]) == 1
    assert len(rec.sent) == 1
    body = rec.sent[0]
    assert "Naruto" in body
    assert "24 new" in body
    # Named items, but only a few: a bare count is not worth reading, and the whole
    # list would not fit in a query string.
    assert "Ep 1" in body
    assert "and 19 more" in body


def test_nothing_is_sent_without_events(cfg):
    rec = Recorder()
    assert notify.dispatch("Naruto", [], cfg=cfg, notifiers=[rec]) == 0
    assert rec.sent == []


def test_a_failing_notifier_is_swallowed(cfg):
    """The events it describes are already committed; the timeline is the source
    of truth, so a provider outage must not surface as a poll failure."""
    ok = Recorder()
    assert (
        notify.dispatch(
            "Naruto", [_event("Ep 1")], cfg=cfg, notifiers=[Recorder(boom=True), ok]
        )
        == 1
    )
    # The healthy channel still got its message.
    assert len(ok.sent) == 1


def test_problem_events_are_reported_too(cfg):
    rec = Recorder()
    events = [_event("Naruto", "Checks are failing", kind="watcher_error")]
    assert notify.dispatch("Naruto", events, cfg=cfg, notifiers=[rec]) == 1
    assert "Checks are failing" in rec.sent[0]


# --- the CallMeBot adapter --------------------------------------------------- #


def test_callmebot_is_disabled_until_fully_configured():
    adapter = notify.CallMeBotNotifier()
    assert adapter.enabled(AppConfig()) is False
    # Nothing is ever sent on the strength of a half-filled form.
    assert adapter.enabled(AppConfig(notifications_enabled=True)) is False
    assert (
        adapter.enabled(AppConfig(notifications_enabled=True, callmebot_phone="336"))
        is False
    )
    assert (
        adapter.enabled(
            AppConfig(
                notifications_enabled=True, callmebot_phone="336", callmebot_apikey="k"
            )
        )
        is True
    )


def test_callmebot_is_off_when_notifications_are_off():
    """The master switch wins, so a configured number can be silenced without
    clearing the credentials."""
    cfg = AppConfig(
        notifications_enabled=False, callmebot_phone="336", callmebot_apikey="k"
    )
    assert notify.CallMeBotNotifier().enabled(cfg) is False


def test_callmebot_sends_the_expected_request(cfg, monkeypatch):
    calls: list[str] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

    class FakeClient:
        def __init__(self, **kwargs):
            # A verifying client, unlike the scraper's: this request carries a key.
            assert "verify" not in kwargs or kwargs["verify"] is True

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def get(self, url: str):
            calls.append(url)
            return FakeResponse()

    monkeypatch.setattr(notify.httpx, "Client", FakeClient)
    notify.CallMeBotNotifier().send("sestudio · Naruto — 1 new", cfg)

    assert len(calls) == 1
    url = calls[0]
    assert url.startswith("https://api.callmebot.com/whatsapp.php?")
    assert "phone=33612345678" in url
    assert "apikey=secret-key" in url
    assert "sestudio" in url


def test_a_long_message_is_truncated(cfg, monkeypatch):
    """The whole message rides in a query string, so it cannot be unbounded."""
    captured: list[str] = []

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def get(self, url: str):
            captured.append(url)

            class R:
                def raise_for_status(self):
                    return None

            return R()

    monkeypatch.setattr(notify.httpx, "Client", FakeClient)
    notify.CallMeBotNotifier().send("x" * 5000, cfg)
    # Roughly the cap, allowing for the rest of the query string.
    assert len(captured[0]) < 1500


def test_the_api_key_is_never_logged(cfg, caplog):
    """The key is a secret in a plaintext config; a warning line must not leak it."""

    class Boom:
        id = "boom"

        def enabled(self, c):
            return True

        def send(self, summary, c):
            raise RuntimeError("upstream said no")

    with caplog.at_level("WARNING"):
        notify.dispatch("Naruto", [_event("Ep 1")], cfg=cfg, notifiers=[Boom()])

    logged = " ".join(r.getMessage() for r in caplog.records)
    assert "upstream said no" in logged
    assert "secret-key" not in logged
