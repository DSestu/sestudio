"""Watchers: saved criteria the server re-evaluates on a schedule.

A watcher stores what to look for (a season page, a search, a set of metadata
filters), the poller re-evaluates it periodically, and anything that was not
there last time becomes a timeline event — optionally auto-downloaded.

The split across modules follows what each layer is allowed to touch:

* ``keys``   — pure functions. Turn site data into stable item keys.
* ``kinds``  — per-kind collectors. Blocking site/metadata I/O, no database.
* ``engine`` — ``poll_once``: collector, then diff, then events. Sync, so it is
  testable without an event loop.
* ``poller`` — the async loop that decides *when* ``poll_once`` runs.
"""

from sestudio.watchers.engine import TransientEmptyResult, poll_once
from sestudio.watchers.models import (
    DEFAULT_INTERVALS,
    WATCHER_KINDS,
    Hit,
    Watcher,
    validate_config,
)

__all__ = [
    "DEFAULT_INTERVALS",
    "WATCHER_KINDS",
    "Hit",
    "TransientEmptyResult",
    "Watcher",
    "poll_once",
    "validate_config",
]
