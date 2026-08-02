# sestudio — Product Specification

Supersedes (in this file): the prior "uvx Packaging & Distribution" spec, which remains in
git history (`git log --all -- SPEC.md`) and covered the now-shipped packaging work.

> North-star spec for sestudio's evolution from a single-source fstream downloader into a
> personal, multi-functionality streaming aggregator. The executable roadmap lives in the phased
> plan (`~/.claude/plans/binary-leaping-cook.md`); the deep research behind it is in
> `docs/RESEARCH-aggregator-ux.md`. This file is the durable *what* and *why*; the plan is the *how*.

## 1. Objective

**Build a personal, self-hosted streaming aggregator that unifies discovery, watching, casting, and
downloading across many content sources — starting from the existing fstream + casting core.**

The product's identity is the **phone → watch → cast → download** loop: a mobile-first web UI, run on
a home server (LAN / Tailscale), that lets one user find something, play it in the browser or throw
it to a TV (DLNA / Chromecast / AirPlay) with seamless handoff, and download it either to the server
or to the device in hand.

### Target user

- **Single user, personal self-host** (household at most). Accessed over LAN / Tailscale, primarily
  from a phone browser (the casting flow starts there), also desktop.
- **No accounts, no multi-tenancy, no telemetry.** State is local (localStorage now; a single-user
  server-side JSON store is the only sanctioned future upgrade path).

### Success looks like

- Open on a phone → resume what you were watching → cast it to the TV at the same position → later
  pull it back to the phone — all without friction.
- Search a title → see rich metadata → play, cast, or download it (to server or device).
- Everything works at 320px width and installs as a PWA.

## 2. Feature set (phased)

The feature set *is* the roadmap. Each phase ends with a frontend rebuild for local testing and a
pause for approval. Full acceptance criteria live in the plan; summary:

| Phase | Scope | Core acceptance |
|---|---|---|
| **1. Foundation & polish** | New "cinematic dark" daisyUI theme (semantic tokens only), a11y (keyboard, labels, states), split `SeasonTree`, **mobile-first responsive (320px, bottom-sheets, ≥44px) + PWA** | Build/lint clean; no raw palette utilities; installable; no horizontal scroll on mobile |
| **2. Watch-state & library** | localStorage store (continue-watching, next-up, resume, watched flags), thread series/season identity to the player, **unified playback session** | Play → reload → resumes and appears in Continue Watching; ≥90% marks watched |
| **3. Player + Web↔TV handoff** | Auto-next countdown, remember volume/speed, native track menus; **cast-from-player at current position + pull-back-to-browser** | Handoff resumes at the same position both directions |
| **4. Flexible downloads** | Destination choice: **server** (as today) or **this device** via server-forwarding (MP4 pass-through; HLS ffmpeg-mux) | Both destinations work; server path unchanged |
| **5. Discovery & metadata** | TMDB enrichment (posters, synopsis, cast, rating), title detail header, browse rows (trending/genre); graceful fallback without a key | Enriched cards + trending; degrades cleanly when no key |

**Guiding architecture** (from the research): sources should trend toward a **uniform provider
interface** (Stremio-style: catalog / meta / stream / subtitles) so new sources are additive. Not a
near-term phase, but new code should not entrench fstream-specific assumptions above the resolver.

## 3. Commands

**Backend / app (Python, `uv` + hatchling):**
- Run web UI (dev, editable): `uv run sestudio serve` — serves the built `frontend/dist/` if present.
- Run web UI (isolated, like a user): `./start.sh` (`uvx --with-editable . sestudio serve`).
- CLI download: `uv run sestudio download <url> [-e 1,3,5-8] [--lang vf|vostfr] [-o DIR]`.
- Tests: `uv run pytest tests/` (or `./tests.sh`).
- Lint/format: `uv run ruff check` / `uv run ruff format`.
- Pre-commit (all files): `./precommit.sh` (`uv run pre-commit run --all-files`).

**Frontend (`frontend/`, Node 18+):**
- Dev server (HMR, cross-origin to `/api`): `npm run dev`.
- **Build (required after every phase):** `npm run build` (`tsc -b && vite build` → `frontend/dist/`).
- Lint: `npm run lint`.

**Wheel packaging:** `npm --prefix frontend run build` must run before `uv build` — the wheel
force-includes `frontend/dist` at `sestudio/web/static` so the installed app serves the UI.

## 4. Project structure

```
src/sestudio/
  cli.py                 # fire-based CLI entrypoint (sestudio = sestudio.cli:main)
  web/
    app.py               # FastAPI app factory; routers mounted under /api; SPA fallback
    routers: search, seasons, downloads, settings, stream, cast
    static/              # built frontend, bundled into the wheel
  config.py              # ~/.config/sestudio/config.json — atomic JSON persistence pattern
  (scraper, providers, proxy, worker, http_client, models …)
frontend/src/
  App.tsx                # top-level composition
  api.ts                 # typed /api client (single source of API types)
  components/            # presentational + modal components (daisyUI)
    season/              # (Phase 1) split-out SeasonTree pieces
  useProviderSources.ts  # per-host probe/resolve hook
  cast.ts, castQueue.ts, dlnaControl.ts   # casting + queue + external stores
  watchState.ts          # (Phase 2) localStorage watch-state store
  index.css              # Tailwind v4 + daisyUI theme (@plugin)
tests/                   # pytest; fixtures/, providers/; 12 test modules, ~60 tests
docs/                    # research + design notes
```

**Persistence:** no database. Server state = the single JSON config file (atomic write via
`config.py`); any new single-user server state follows that exact pattern. Client state = localStorage
behind a small isolated interface. Download jobs and cast sessions are in-memory (lost on restart, by
design).

## 5. Code style

**Python:** ruff (lint + format) is the authority — match it. Type hints on public functions;
dataclasses for config, Pydantic models for API bodies (keep the persisted dataclass shape decoupled
from the API model, as `config.py` / `settings.py` already do). Keep the raw upstream stream URL
server-side only (HMAC-sealed proxy tokens) — never leak it to the client. New endpoints mount under
`/api` via a router, registered in `app.py`.

**Frontend:** TypeScript, function components + hooks. **daisyUI semantic tokens only**
(`primary`, `secondary`, `base-*`, `error`) — no raw Tailwind palette utilities (`violet-*`,
`blue-*`, …) and no inline hex. Keep components < ~200 lines (split when larger). `api.ts` is the
single home for API types and fetch calls. Match existing idioms: external stores for cross-component
live state (cast/dlna), refs to keep callbacks fresh across a persistent player element, the
`useModalBack` history pattern for every modal.

**Accessibility (WCAG 2.1 AA) is non-negotiable:** every interactive element keyboard-operable and
labeled; visible focus; contrast ≥ 4.5:1; never color as the sole signal; loading/empty/error states
on every async surface; skeletons over spinners for content.

## 6. Testing strategy

- **Backend:** pytest (`tests/`), with `pytest-httpx` for mocking upstream HTTP. New backend behavior
  (Phase 4 download-forwarding, Phase 5 TMDB matcher/cache) ships with tests. The existing ~60 tests
  must stay green after every change.
- **Frontend:** `npm run build` (tsc typecheck + vite) and `npm run lint` must pass each phase; no
  test runner is configured today (add one only if a phase's logic warrants it — e.g. the watch-state
  store).
- **Manual / integration:** drive the running app via the browser (Chrome MCP) at **320**/768/1024/1440
  each phase; Tab-through keyboard check; and explicitly re-verify the **cast + download core loop**
  after any change that touches `PlayableEpisode` / `playlistFrom` / the proxy.
- **Cadence:** rebuild `frontend/dist` at the end of every phase so `uv run sestudio serve` reflects
  changes for local testing before approval.

## 7. Boundaries

**Always do**
- Rebuild the frontend (`npm run build`) at the end of each phase before pausing for approval.
- Keep the **cast + download core loop working** (DLNA / Chromecast / AirPlay playback and existing
  server-side downloads are regression-critical) — re-verify after every change that could touch it.
- Preserve accessibility, semantic-token, and mobile-first standards on all new UI.
- Keep upstream stream URLs sealed server-side.

**Ask first**
- Before **committing or pushing** anything — stage changes, show the diff, wait for explicit consent.
  A prior "commit" does not authorize later commits. Same for branch creation, force-push, resets.
- Before widening scope beyond the current phase, or before the heavy HLS-mux sub-task in Phase 4.
- Before introducing any new runtime dependency, external service, or a server-side persistence store
  (the localStorage → server-JSON upgrade).

**Never do**
- **No telemetry / no phoning home.** No user data leaves the server except to the explicitly
  configured source (fstream) and metadata provider (TMDB, with the user's own key).
- **Do not bundle/entrench content sources as the product's core.** Treat sources as
  pluggable/user-added and keep the architecture source-agnostic above the resolver (legal/ToS
  posture) — don't grow the scraper set as a selling point.
- No multi-user/auth/tenancy assumptions — this is single-user by design.
- No raw hex or Tailwind palette utilities in the UI; no inaccessible interactive elements.
