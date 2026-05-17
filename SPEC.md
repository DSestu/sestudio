# SPEC: fstream-dl Web UI

## Objective
Add a local web interface to fstream-dl that proxies the fstream search engine, lets the user browse results, select seasons/episodes via a checkbox tree, configure download settings, and monitor per-episode progress. Target: single user, self-hosted, runs on localhost.

---

## Commands

```
fstream-dl serve [--host 0.0.0.0] [--port 8080]
```
Starts the FastAPI + static frontend server. Downloads dispatched from the UI continue running as long as the process is alive. Ctrl-C stops the server but not in-flight downloads (they run in a background thread pool).

---

## Core Features & Acceptance Criteria

### Search
- Input box proxies fstream search → returns list of season cards
- Each card shows: series title, poster image, language badges (VF / VOSTFR), episode count
- Results update as user types (debounced) or on submit

### Selection tree
- Three levels: Series → Season → Episode (expand/collapse)
- Checkboxes cascade: check series → all seasons checked; uncheck one season → series goes indeterminate
- Episode level shows episode number + title

### Global settings panel
- Language selector (VF / VOSTFR) — overrides any per-item setting
- Output root path (text input, default from config or `.`)

### Download queue
- "Download selected" button dispatches jobs to FastAPI background worker
- Per-episode progress bar (bytes or percentage from yt-dlp `--progress` output)
- Status badges: queued / downloading / done / failed
- UI stays open; downloads survive UI closure as long as server process runs

### Config persistence
- Output root and default language saved to `~/.config/fstream-dl/config.json`

---

## Project Structure

```
src/fstream_dl/
  web/
    app.py          # FastAPI app, mounts static files
    routes/
      search.py     # GET /api/search?q=
      seasons.py    # GET /api/season?url=
      downloads.py  # POST /api/downloads, GET /api/downloads
      settings.py   # GET/PUT /api/settings
    worker.py       # Background download executor (reuses downloader.py)
    progress.py     # SSE progress emitter
frontend/           # React app (Vite)
  src/
    components/
      SearchBar.tsx
      ResultsGrid.tsx
      SeasonTree.tsx
      DownloadQueue.tsx
      SettingsPanel.tsx
  dist/             # built assets, served by FastAPI as /static
```

---

## Tech Stack

| Layer | Choice |
|---|---|
| Backend | FastAPI + uvicorn |
| Frontend | React + TypeScript (Vite) |
| Progress streaming | Server-Sent Events (SSE) |
| State management | React built-in (useState/useContext) |
| Styling | Tailwind CSS |
| Build | `vite build` → `frontend/dist/`, committed or built on install |
| New deps | `fastapi`, `uvicorn`, `python-multipart` |

---

## Code Style
- All Python with full type annotations and `from __future__ import annotations`
- FastAPI route functions are thin — business logic stays in existing modules
- Frontend: functional components only, no class components
- No global mutable state in the worker — each job is a dataclass with a thread-safe status field

---

## Testing Strategy
- Unit tests for `search.py` route (mock httpx, assert response shape)
- Unit tests for `seasons.py` route (reuse existing scraper fixtures)
- Unit tests for `downloads.py` route (mock worker, assert job creation)
- Frontend: no automated tests in this phase (manual browser verification)

---

## Boundaries

| Always | Ask first | Never |
|---|---|---|
| Resolve live domain at serve startup | Overwrite existing downloaded file | Store credentials or session tokens |
| Sanitize all filenames | Delete a partially downloaded file | Expose the server on 0.0.0.0 by default |
| Respect `--no-resolve` flag | Change default output path | Embed provider secrets in frontend |
