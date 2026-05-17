# fstream-dl — Task List

## Phase 1 — Data pipeline

- [ ] **1.1** `scraper.py` — season page fetch + episode list from `/data/eps_<newsId>.txt`
- [ ] **1.2** `providers/base.py` + `providers/uqload.py` — embed URL → mp4 StreamSource
- [ ] **1.3** Test fixtures (season HTML, eps JSON, uqload embed HTML) + `tests/conftest.py`
- [ ] **1.4** `tests/test_scraper.py` — scraper unit tests
- [ ] **1.5** `tests/test_providers.py` — uqload unit tests
- [ ] **CHECKPOINT 1** — `uv run pytest` passes ✓

## Phase 2 — Working CLI

- [ ] **2.1** `downloader.py` — yt-dlp wrapper + ThreadPoolExecutor
- [ ] **2.2** `cli.py` — Click entry point, episode filter, dry-run, download flow
- [ ] **CHECKPOINT 2** — manual end-to-end test ✓

## Phase 3 — Polish

- [ ] **3.1** Error handling — lang missing, no URL, yt-dlp absent, timeout
- [ ] **3.2** `resolver.py` — wire live domain resolution into CLI
