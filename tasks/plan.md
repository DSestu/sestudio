# Plan: fstream-dl Web UI

## Context
The CLI tool (`fstream-dl`) can download episodes but requires knowing the exact season URL. The goal is a local web interface that proxies fstream's search, lets the user pick seasons/episodes via a checkbox tree, and streams per-episode download progress — all from a browser. A new `fstream-dl serve` subcommand starts the server.

---

## Key findings

- **CLI is a single `@click.command()`** → must refactor to `@click.group()` to add `serve`
- **No search function** in `scraper.py` → search endpoint is `GET /index.php?do=search&subaction=search&story={query}`, returns HTML with `<div data-newsid data-title data-affiche data-fulllink>` elements per season result
- **No progress tracking** in `downloader.py` → yt-dlp runs with `--quiet`; must switch to `--progress --newline` and parse stdout lines in real-time with a callback
- **All httpx usage is synchronous** → keep sync for scraper calls wrapped in `asyncio.to_thread()` inside FastAPI route handlers
- **Config**: persist to `~/.config/fstream-dl/config.json` (output root, default lang)

---

## Architecture

```
src/fstream_dl/
  cli.py                 # MODIFIED: @click.group(), download → subcommand, serve subcommand
  config.py              # NEW: read/write ~/.config/fstream-dl/config.json
  scraper.py             # MODIFIED: add search_seasons(query) function
  downloader.py          # MODIFIED: add progress_callback param, parse yt-dlp stdout
  web/
    __init__.py
    app.py               # FastAPI app factory, mounts router + static files
    routes/
      __init__.py
      search.py          # GET /api/search?q=
      seasons.py         # GET /api/season?url=
      downloads.py       # POST /api/downloads, GET /api/downloads, GET /api/downloads/{id}/progress (SSE)
      settings.py        # GET /api/settings, PUT /api/settings
    worker.py            # DownloadJob dataclass, in-memory job store, ThreadPoolExecutor
frontend/                # Vite + React + TypeScript + Tailwind
  src/
    api.ts               # typed fetch wrappers for all API routes
    components/
      SearchBar.tsx
      ResultsGrid.tsx     # season cards with poster, badges, episode count
      SeasonTree.tsx      # 3-level checkbox tree with cascading state
      DownloadQueue.tsx   # job list with SSE-fed progress bars
      SettingsPanel.tsx   # output path + language selector
    App.tsx
  dist/                  # built assets served by FastAPI
```

---

## New Python deps to add
```
fastapi>=0.115
uvicorn[standard]>=0.34
python-multipart>=0.0.20
```

---

## Search endpoint (discovered)
- URL: `GET {live_domain}/index.php?do=search&subaction=search&story={query}`
- Response: HTML page
- Each result is a `<div>` with attributes: `data-newsid`, `data-title`, `data-affiche` (poster URL), `data-fulllink` (season page path)
- Season number extracted from `data-title` via existing `SEASON_RE` regex
- Series name = title before ` - Saison N`

---

## Progress tracking design
- Remove `--quiet` from yt-dlp command, add `--progress --newline`
- Parse stdout lines matching `[download]  X% of Y at Z ETA W`
- `download()` accepts optional `on_progress: Callable[[ProgressEvent], None] | None`
- `ProgressEvent(percent: float, speed: str, eta: str)`
- Worker stores last progress on `DownloadJob` dataclass; SSE route reads it every 500ms

---

## Folder structure for downloads
`{output_root}/{series_name}/Season {season:02d}/S{season:02d}E{ep:02d} - {title}.mp4`
