# fstream-dl — Spec

## 1. Objective

CLI tool to download episodes from fstream streaming pages (currently fs03.lol, reached via fstream.top).  
Target user: personal use, single operator.

The tool must work without any AI agent — all logic is plain-coded.

---

## 2. Commands

### Entry point
```
fstream-dl <season-url> [options]
```

### Options
| Flag | Default | Description |
|------|---------|-------------|
| `--episodes` / `-e` | (all) | Comma-separated episode numbers, e.g. `1,3,5-8` |
| `--lang` | `vf` | Language: `vf` or `vostfr` |
| `--output` / `-o` | `.` | Output directory |
| `--concurrency` / `-c` | `20` | Max parallel yt-dlp workers |
| `--provider` | `uqload` | Provider: `uqload`, `vidzy` (future: auto-fallback) |
| `--dry-run` | `false` | Print resolved URLs without downloading |

### Examples
```bash
# Download all episodes in VF
fstream-dl "https://fs03.lol/16676-stargate-sg-1-saison-1-streaming-complet-vf-vostfr.html"

# Download episodes 1-3 in VOSTFR
fstream-dl "https://fs03.lol/..." --episodes 1-3 --lang vostfr

# Dry run to inspect URLs
fstream-dl "https://fs03.lol/..." --dry-run
```

---

## 3. Architecture

### Provider priority
1. **Uqload** (default, simplest) — stream URL in plain HTML, no tokens, direct mp4
2. **Vidzy** (fallback) — requires JS execution via browser-based extraction, token expires

### Domain resolution (future-ready)
- `resolver.py` will fetch `https://fstream.top` and follow redirects to determine the live domain  
- For now, the URL is passed directly by the user; the resolver module exists but is a no-op pass-through

### Scraping strategy
- Use `httpx` with session cookies and correct headers (`Referer`, `User-Agent`)
- Parse season page HTML with `beautifulsoup4` to extract:
  - Episode list with numbers and titles
  - Per-episode embed URLs for each provider (from HTML data attributes or JS variables in the page source)
- No browser automation for Uqload extraction — it's a pure HTML scrape
- Playwright used only for Vidzy (future)

### Uqload extraction flow
```
season page HTML
  → find episode rows (VF or VOSTFR column)
  → extract uqload embed URL per episode
  → fetch embed page HTML
  → regex: extract mp4 URL (https://strm*.uqload.is/<hash>/v.mp4)
  → yt-dlp with --referer https://uqload.is/
```

### Vidzy extraction flow (future)
```
season page HTML
  → find vidzy embed URL per episode
  → headless browser (playwright) → click play → intercept videojs currentSrc()
  → yt-dlp with --referer https://vidzy.org/
```

### Download
- `yt-dlp` subprocess per episode, pooled via `concurrent.futures.ThreadPoolExecutor(max_workers=concurrency)`
- Output format: `mp4` (yt-dlp: `--merge-output-format mp4`)
- Filename template: `S{season:02d}E{episode:02d} - {title}.mp4`
- Referer passed via `--add-header "Referer: <provider_referer>"`

---

## 4. Project Structure

```
fstream_downloader/
├── pyproject.toml               # uv project config
├── SPEC.md
├── src/
│   └── fstream_dl/
│       ├── __init__.py
│       ├── cli.py               # Click entry point
│       ├── resolver.py          # fstream.top → live domain (no-op for now)
│       ├── scraper.py           # Season page parsing, episode list, embed URL extraction
│       ├── providers/
│       │   ├── __init__.py
│       │   ├── base.py          # Abstract StreamProvider (get_stream_url)
│       │   ├── uqload.py        # Uqload: HTML scrape → mp4 URL
│       │   └── vidzy.py         # Vidzy: placeholder, raises NotImplementedError
│       └── downloader.py        # yt-dlp wrapper + ThreadPoolExecutor
└── tests/
    ├── test_scraper.py
    ├── test_providers.py
    └── fixtures/                # Saved HTML snippets for offline tests
```

---

## 5. Code Style

- Python 3.11+
- Type hints on all function signatures
- Dataclasses for data models (`Episode`, `StreamSource`)
- No global mutable state
- `httpx` for HTTP (not `requests`)
- `click` for CLI
- Errors: raise typed exceptions, catch at CLI boundary and print user-friendly message
- No print statements inside library code — use `logging` or return values

### Key models
```python
@dataclass
class Episode:
    number: int
    title: str
    season: int
    embed_urls: dict[str, str]   # provider_name -> embed_url

@dataclass
class StreamSource:
    url: str
    referer: str
    provider: str
```

---

## 6. Testing Strategy

- `pytest` with `pytest-httpx` for mocking HTTP
- Fixture HTML files in `tests/fixtures/` (real page snapshots, sanitised)
- Unit tests:
  - `test_scraper.py`: episode extraction from fixture HTML
  - `test_providers.py`: Uqload URL extraction from fixture embed HTML
- No live network calls in tests (all mocked)
- Run with: `uv run pytest`

---

## 7. Boundaries

| Rule | Detail |
|------|--------|
| **Never hardcode the live domain** | Always go through `resolver.py` |
| **Always set Referer** | Each provider has a fixed referer constant |
| **Never store credentials** | No auth, no login flow |
| **No AI agent inside the tool** | All logic is explicit, deterministic code |
| **yt-dlp only for downloading** | No custom chunk streaming |
| **Concurrency cap** | Respect `--concurrency` flag, default 20 |

---

## 8. Out of Scope (for now)

- Web UI (planned later)
- Search proxification (planned later)
- Bulk season download via search (planned later)
- Folder structure organisation (planned later)
- Netu / Voe providers (too complex, require browser session)
- Vidzy provider (requires headless browser — implement after Uqload is stable)
- VOSTFR availability check (some episodes may not have VOSTFR — fail gracefully)
