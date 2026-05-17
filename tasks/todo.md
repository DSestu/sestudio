# Task List: fstream-dl Web UI

## Phase 1 — Backend foundation

- [ ] **T1** CLI group refactor — `@click.group()`, move download logic to `download` subcommand, add `serve` stub with `--host`/`--port`
- [ ] **T2** Config module — `src/fstream_dl/config.py`, `AppConfig` dataclass, `load_config()` / `save_config()`, persists to `~/.config/fstream-dl/config.json`
- [ ] **T3** Search scraper + route — `search_seasons(query, base_url)` in `scraper.py`; `GET /api/search?q=` route
- [ ] **T4** Season detail route — `GET /api/season?url=` wrapping existing `fetch_season()`, returns episodes + available langs
- [ ] **T5** Settings route — `GET /api/settings`, `PUT /api/settings` backed by config module
- [ ] **T6** Download worker + progress — modify `downloader.py` for yt-dlp stdout progress parsing; `worker.py` with `DownloadJob`, `JobStore`, `ThreadPoolExecutor`
- [ ] **T7** Downloads route + SSE — `POST /api/downloads`, `GET /api/downloads`, `GET /api/downloads/{id}/progress` (SSE)

### CHECKPOINT A — all API routes working via curl before starting frontend

## Phase 2 — Frontend

- [ ] **T8** Frontend scaffold — Vite + React + TypeScript + Tailwind; `/api` proxy to FastAPI; `src/api.ts` typed wrappers
- [ ] **T9** SearchBar + ResultsGrid — debounced search input, season cards with poster/title/language badges
- [ ] **T10** SeasonTree — 3-level checkbox tree (series → season → episode), cascading check/indeterminate state, "Download selected" button
- [ ] **T11** SettingsPanel + DownloadQueue — settings form (output path, lang), job list with SSE progress bars and status badges
- [ ] **T12** Build integration — `vite build` → `frontend/dist/`, FastAPI serves as static + SPA fallback; `fstream-dl serve` opens `http://localhost:{port}`

### CHECKPOINT B — full end-to-end flow: search → select → download → progress
