from __future__ import annotations

import logging
from typing import Any, Protocol
from urllib.parse import urlencode

import httpx

from sestudio.config import AppConfig, load_config

logger = logging.getLogger(__name__)

# Outbound notification, kept behind a seam so the timeline is never coupled to a
# messaging provider. Events are already committed by the time anything here runs:
# a provider being down must cost a message, never an inbox row.

_TIMEOUT = 10
_CALLMEBOT_URL = "https://api.callmebot.com/whatsapp.php"

# Longest message sent. CallMeBot puts the whole message in a query string, and a
# season landing at once would otherwise build a URL nothing accepts.
_MAX_BODY = 900


class Notifier(Protocol):
    """One outbound channel."""

    id: str

    def enabled(self, cfg: AppConfig) -> bool: ...

    def send(self, summary: str, cfg: AppConfig) -> None: ...


class CallMeBotNotifier:
    """WhatsApp via CallMeBot.

    Unofficial and rate-limited, which is why messages are coalesced to one per
    watcher per poll rather than one per item. Chosen over the Meta Cloud API
    because it needs no business account, no registered number and no template
    approval — at the cost of being someone else's free service.
    """

    id = "callmebot"

    def enabled(self, cfg: AppConfig) -> bool:
        return bool(
            cfg.notifications_enabled and cfg.callmebot_phone and cfg.callmebot_apikey
        )

    def send(self, summary: str, cfg: AppConfig) -> None:
        params = {
            "phone": cfg.callmebot_phone,
            "text": summary[:_MAX_BODY],
            "apikey": cfg.callmebot_apikey,
        }
        # Built by hand only to keep the key out of any log line: the URL is never
        # logged, and errors are reported without it.
        url = f"{_CALLMEBOT_URL}?{urlencode(params)}"
        # A verifying client, unlike the scraper's: this request carries a secret.
        with httpx.Client(timeout=_TIMEOUT, follow_redirects=True) as client:
            resp = client.get(url)
            resp.raise_for_status()


NOTIFIERS: list[Any] = [CallMeBotNotifier()]


def summarise(label: str, events: list[dict[str, Any]]) -> str:
    """One line for a watcher's findings this poll.

    Coalesced deliberately: a whole season arriving is one message, not
    twenty-four. The first few titles are named because a bare count is not worth
    reading.
    """
    name = label or "Watcher"
    items = [e for e in events if e.get("event_type") == "new_item"]
    if not items:
        problems = [e for e in events if e.get("event_type") != "new_item"]
        if problems:
            return f"sestudio · {name}: {problems[0].get('subtitle') or 'check failed'}"
        return ""

    lines = [f"sestudio · {name} — {len(items)} new"]
    for event in items[:5]:
        detail = event.get("subtitle") or ""
        lines.append(f"• {event.get('title', '')}{f' ({detail})' if detail else ''}")
    if len(items) > 5:
        lines.append(f"…and {len(items) - 5} more")
    return "\n".join(lines)


def dispatch(
    label: str,
    events: list[dict[str, Any]],
    *,
    cfg: AppConfig | None = None,
    notifiers: list[Any] | None = None,
) -> int:
    """Send one coalesced summary per enabled channel. Returns messages sent.

    Never raises: the events it describes are already stored, and the timeline is
    the source of truth. A failed send is logged and dropped rather than retried —
    a duplicate WhatsApp message hours later is worse than a missed one.
    """
    if not events:
        return 0
    cfg = cfg or load_config()
    summary = summarise(label, events)
    if not summary:
        return 0

    sent = 0
    for notifier in notifiers if notifiers is not None else NOTIFIERS:
        try:
            if not notifier.enabled(cfg):
                continue
            notifier.send(summary, cfg)
            sent += 1
        except Exception as exc:
            # Never include the URL or params: they carry the API key.
            logger.warning("Notifier %s failed: %s", getattr(notifier, "id", "?"), exc)
    return sent
