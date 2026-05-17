# fstream-dl — Implementation Plan

## Context

From live browser exploration we know:

- **Season page** (`fs03.lol/<id>-...-vf-vostfr.html`) loads episode data from `/data/eps_<newsId>.txt`
- The `newsId` is in a `#serie-config` element's `data-news-id` attribute
- `/data/eps_<newsId>.txt` returns JSON: `{ vf: {1: {uqload, vidzy, netu, voe, ...}, ...}, vostfr: {...}, info: {...} }`
- **Uqload embed HTML** contains the mp4 URL directly in plain HTML: `https://strm*.uqload.is/<hash>/v.mp4`
- Uqload requires `Referer: https://uqload.is/`
- Episode title comes from `data.info[n]` or falls back to `Episode N`
- Season number must be parsed from the page HTML (title or URL slug)

## What already exists

| File | Status |
|------|--------|
| `pyproject.toml` | Done — uv project, deps, entry point wired |
| `src/fstream_dl/models.py` | Done — `Episode`, `StreamSource` dataclasses |
| `src/fstream_dl/resolver.py` | Done — pass-through + `resolve_live_domain()` stub |
| `src/fstream_dl/__init__.py` | Done — empty |
| `src/fstream_dl/providers/__init__.py` | Done — empty |

## Dependency Graph

```
models.py  ← (no deps)
resolver.py ← httpx
scraper.py ← httpx, bs4, models.py, resolver.py
providers/base.py ← models.py
providers/uqload.py ← httpx, re, providers/base.py, models.py
downloader.py ← subprocess, concurrent.futures, models.py
cli.py ← click, rich, scraper.py, providers/uqload.py, downloader.py
```

No cycles. Build order follows the graph top-down.

---

## Phases

### Phase 1 — Core scraper + Uqload provider (vertical slice, end-to-end)

**Goal**: given a season URL, extract all episodes with their Uqload embed URLs and resolve each to a direct mp4 URL.  
No CLI, no download yet — just the data pipeline working and tested.

#### Task 1.1 — `scraper.py`: season page → episode list

**What to build:**
- `fetch_season_page(url) -> (season: int, episodes: list[Episode])`
- Fetches the season page with proper headers
- Parses `#serie-config[data-news-id]` to get `newsId`
- Fetches `/data/eps_<newsId>.txt`
- Parses JSON into `Episode` objects (number, title from `info`, embed_urls dict)
- Extracts season number from page `<title>` tag (e.g. "Stargate SG-1 - Saison 1 …" → 1)

**Acceptance criteria:**
- Returns correct season number
- Returns 22 episodes for the Stargate SG-1 S1 test page
- Each episode has `embed_urls["uqload"]` populated
- Episodes with missing uqload entry have empty string (not KeyError)

**Verification:** `uv run pytest tests/test_scraper.py -v`

---

#### Task 1.2 — `providers/base.py` + `providers/uqload.py`

**What to build:**
- `base.py`: abstract `StreamProvider` with `get_stream_url(embed_url: str) -> StreamSource`
- `uqload.py`: fetches embed page HTML, regex-extracts `https://strm*.uqload.is/<hash>/v.mp4`, returns `StreamSource(url, referer="https://uqload.is/", provider="uqload")`

**Acceptance criteria:**
- Correct mp4 URL extracted from fixture embed HTML
- Raises `ProviderError` if no URL found in HTML
- `referer` is always `https://uqload.is/`

**Verification:** `uv run pytest tests/test_providers.py -v`

---

#### Task 1.3 — Test fixtures

**What to build:**
- `tests/fixtures/season_page.html` — real fs03.lol season page snapshot (Stargate SG-1 S1)
- `tests/fixtures/eps_16676.json` — real `/data/eps_16676.txt` response
- `tests/fixtures/uqload_embed.html` — real Uqload embed page snapshot
- `tests/conftest.py` — shared fixtures for httpx mocking

**Note:** Fixtures captured from the live browser session.

---

> **Checkpoint 1**: `uv run pytest` passes. Data pipeline proven end-to-end on fixtures.

---

### Phase 2 — Downloader + CLI (complete working tool)

**Goal**: `fstream-dl <url>` works, downloads files with correct names.

#### Task 2.1 — `downloader.py`

**What to build:**
- `download(source: StreamSource, output_path: Path) -> bool`
  - Runs `yt-dlp` as subprocess with `--referer`, `-o`, `--merge-output-format mp4`
  - Returns True on success, False on non-zero exit
- `download_many(jobs: list[tuple[StreamSource, Path]], concurrency: int) -> dict[str, bool]`
  - `ThreadPoolExecutor(max_workers=concurrency)`
  - Returns map of filename → success

**Acceptance criteria:**
- `yt-dlp` invocation includes correct `--add-header "Referer: ..."` flag
- Concurrent jobs respect `concurrency` cap
- Failures don't abort other downloads

---

#### Task 2.2 — `cli.py`

**What to build:**
- `@click.command` with all flags from spec
- Episode selection parser: `"1,3,5-8"` → `{1, 3, 5, 6, 7, 8}`
- Flow:
  1. Fetch season + episodes via `scraper`
  2. Filter by `--episodes` and `--lang`
  3. Resolve stream URLs via provider
  4. `--dry-run`: print table with Rich, exit
  5. Otherwise: `download_many(...)`, print summary

**Acceptance criteria:**
- `fstream-dl --help` shows all flags
- `--dry-run` prints episode table without calling yt-dlp
- `--episodes 1-3` downloads only episodes 1, 2, 3
- `--lang vostfr` uses VOSTFR column
- Missing episode in selected lang prints warning, skips gracefully

---

> **Checkpoint 2**: Full manual end-to-end test:
> ```bash
> fstream-dl "https://fs03.lol/16676-..." --episodes 1 --dry-run
> fstream-dl "https://fs03.lol/16676-..." --episodes 1
> ```
> File `S01E01 - Enfants des dieux (1-2) VF.mp4` created in current dir.

---

### Phase 3 — Polish

#### Task 3.1 — Error handling & edge cases
- Episode not available in chosen language → skip with warning
- Uqload embed returns no mp4 URL → log error, skip episode
- yt-dlp not found → raise clear error at startup
- Network timeout → retry once, then skip

#### Task 3.2 — `resolver.py` live domain resolution
- Wire `resolve_live_domain()` into CLI startup
- Add `--no-resolve` flag to skip (for direct URL use)

---

## Out of scope for this plan
- Vidzy provider (Playwright)
- Web UI
- Folder structure / bulk season management
