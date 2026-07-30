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

---
---

# SPEC: In-browser Player & Cast-to-device

Status: **Approved**
Related prior work: Caddy HTTPS reverse-proxy investigation (memory S1890/S1891), broken upstream TLS handling in `http_client.py`.

## Objective

Let a user **watch an episode directly in the fstream-dl web UI** and **cast it to a device on their LAN** (Chromecast, AirPlay, or DLNA/UPnP TV), without downloading it first. Target: the existing single self-hosted user on a trusted home network — not multi-tenant or public.

### The core problem this solves
Resolved stream URLs (from `uqload`, `vidzy`, `netu`) are **not directly playable by a browser or a cast device**, because every stream requires:
1. A provider-specific `Referer` header (hotlink protection) — JS and cast devices **cannot** set `Referer`.
2. Tolerance of **broken upstream TLS** (expired/mismatched certs) — browsers and cast devices refuse these.
3. HLS streams additionally hit CORS.

The **only** component that can satisfy all three is the Python backend (already uses `httpx` with `verify=False` and sets `Referer` in `http_client.new_client()`). Therefore the keystone of this spec is a **server-side streaming proxy**; the player and all three cast targets consume the proxied stream, never the raw provider URL.

---

## Core Features & Acceptance Criteria

### F1 — Stream resolution endpoint
Reuse existing providers (`get_stream_url`) to turn an embed URL into a playable descriptor.
- `GET /api/stream/resolve?embed_url=<url>&provider=<name>` → `{ proxy_url, kind }`, `kind ∈ {"mp4","hls"}`.
- The raw provider URL and referer are **never** returned to the client — sealed inside a signed proxy token (F2).
- **AC1**: valid uqload embed → `kind:"mp4"` + `proxy_url`.
- **AC2**: valid vidzy/netu embed → `kind:"hls"`.
- **AC3**: provider failure → HTTP 502 with the provider's message (matches `/api/season` style).

### F2 — Server-side streaming proxy (keystone)
- `GET /api/stream/proxy?token=<signed>` where `token` is an **HMAC-signed** opaque blob encoding `{target_url, referer, provider, exp}` — prevents an open relay.
- Forwards the correct `Referer`, uses `new_client()` (TLS verify off), streams back via `StreamingResponse`.
- **MP4 path**: forwards client `Range` upstream; relays `Content-Range`/`Accept-Ranges`/`Content-Length`/206 so seeking works.
- **HLS path**: fetches the `.m3u8` and **rewrites** every URI to point back at `/api/stream/proxy` with a fresh token — segments (`.ts`/`.m4s`), nested playlists (master → media), and `#EXT-X-KEY URI=` values; relative and absolute both handled.
- **AC4**: MP4 seek issues a `Range` request and resumes correctly.
- **AC5**: vidzy master playlist rewritten so the browser loads variants + segments **only** through the proxy (verifiable in network tab).
- **AC6**: AES-128 `#EXT-X-KEY URI` rewritten and key fetched through the proxy.
- **AC7**: tampered/expired `token` → HTTP 403, **no** upstream request issued.

### F3 — In-browser player (Vidstack)
- A **Play** action per episode opens a modal with a Vidstack player pointed at `proxy_url`, selecting HLS or MP4 by `kind`.
- Closing the modal tears down the player and aborts in-flight proxy requests.
- **AC8**: Play starts playback in the modal; closing stops network activity.
- **AC9**: works for an MP4-backed (uqload) and an HLS-backed (vidzy) episode.

### F4 — Cast: Google Cast + AirPlay (client-driven)
- Vidstack's built-in **Google Cast** and **AirPlay** buttons.
- Cast devices fetch `proxy_url` themselves → server MUST be LAN-bound and reachable over **HTTPS with a cert the device trusts** (F6).
- **AC10**: over trusted HTTPS on the LAN, the Cast button lists a Chromecast and casting starts playback.
- **AC11**: AirPlay button casts in Safari on the same network. *(Best-effort; Apple-device dependent.)*

### F5 — Cast: DLNA / UPnP (server-driven)
Web player libraries cannot do DLNA — separate backend path.
- `GET /api/cast/dlna/renderers` — SSDP-discover MediaRenderers → `[{name, udn, control_url}]`.
- `POST /api/cast/dlna/play` — `{renderer_udn, proxy_url}` → `SetAVTransportURI` + `Play`.
- Frontend "Cast to TV" menu lists renderers; selecting one pushes the episode's `proxy_url`.
- DLNA renderers fetch over **HTTP** → works without HTTPS (only LAN-reachable HTTP needed).
- **AC12**: `/api/cast/dlna/renderers` lists a real renderer.
- **AC13**: selecting a renderer starts playback of the proxied stream on it.

### F6 — LAN + HTTPS serving posture
- `serve` binds configurably (already has `--host`); document `--host 0.0.0.0` for LAN reach.
- Provide a **Caddy** reverse-proxy recipe for HTTPS on the LAN IP (reuses prior Caddy work), incl. trusting the local CA on the casting device.
- **AC14**: docs take a user from `serve --host 0.0.0.0` + Caddy to a working HTTPS origin, with the Chromecast cert-trust step called out.

### Non-goals
No transcoding · no auth/multi-user · no watch-history/resume · no public-internet exposure.

---

## Commands

Backend (`uv`):
```bash
uv sync                                              # + async-upnp-client (DLNA)
uv run fstream-dl serve --host 0.0.0.0 --port 8080   # LAN-reachable
uv run pytest tests/web/test_stream_proxy.py -q      # proxy unit tests
uv run ruff check . && uv run ruff format --check .
```
Frontend (`frontend/`):
```bash
npm install        # + @vidstack/react
npm run dev
npm run build      # → frontend/dist served by FastAPI
npm run lint
```
HTTPS for casting:
```bash
caddy reverse-proxy --from https://<lan-ip> --to 127.0.0.1:8080
```

---

## Project Structure (new / changed)

```
src/fstream_dl/
  web/
    routes/stream.py   # NEW  /api/stream/resolve, /api/stream/proxy
    routes/cast.py     # NEW  /api/cast/dlna/renderers, /api/cast/dlna/play
    proxy.py           # NEW  token sign/verify + HLS playlist rewriting
    app.py             # CHANGED  register stream + cast routers
  dlna.py              # NEW  SSDP discovery + SetAVTransportURI (async-upnp-client)
  # providers/*, resolver.py, http_client.py, models.py — reused unchanged
frontend/src/
  components/PlayerModal.tsx  # NEW  Vidstack player + Cast/AirPlay
  components/CastMenu.tsx     # NEW  DLNA renderer list
  api.ts                      # CHANGED  resolveStream(), listRenderers(), dlnaPlay()
  components/SeasonTree.tsx / ResultsGrid.tsx  # CHANGED  Play/Cast affordance
tests/web/test_stream_proxy.py  # NEW  token, Range, HLS rewrite
tests/web/test_cast_dlna.py     # NEW  discovery + play (mocked)
```
New deps: backend `async-upnp-client` (signing uses stdlib `hmac`/`hashlib`); frontend `@vidstack/react`.

---

## Code Style
- **Match the existing codebase** over any general convention.
- Python: `from __future__ import annotations`, full type hints, `logging` (not print), typed exceptions surfaced as HTTP 502/403. Reuse `new_client()` for **all** upstream fetches (never a bare `httpx.Client` — TLS-verify-off lives there deliberately). Keep blocking I/O off the loop with `asyncio.to_thread` (as `routes/seasons.py` does).
- Proxy token secret generated per-process at startup on `app.state`; never hardcoded.
- React/TS: functional components + hooks, DaisyUI classes, the ref-pattern already used for `exhaustive-deps` (SearchBar/SettingsPanel). No new state library.
- Comment *why* (referer/TLS rationale), not *what*; no comments on unchanged code.

---

## Testing Strategy
- **Unit (pytest + respx/httpx mock)** — priority, correctness lives in the proxy:
  - Token sign→verify round-trip; tampered/expired rejected **before** any upstream call (AC7).
  - MP4 `Range` forwarded, 206 + `Content-Range` relayed (AC4).
  - HLS rewriting master→media→segment + `#EXT-X-KEY URI=`, relative & absolute, via captured-playlist fixtures (AC5, AC6).
  - DLNA discovery parses mocked SSDP/description; `play` emits well-formed `SetAVTransportURI` SOAP (AC12/AC13), network mocked.
- Resolve endpoint returns correct `kind` per provider (AC1–AC3); extend existing provider tests.
- **Manual checklist (needs real devices/HTTPS)**: in-browser MP4 + HLS (AC8/AC9); Chromecast over HTTPS (AC10); AirPlay in Safari (AC11); DLNA to a TV (AC13); Caddy walkthrough (AC14).
- Keep existing layout (`tests/web`, `tests/providers`); no framework changes.

---

## Boundaries

| Always | Ask first | Never |
|---|---|---|
| Route every upstream fetch through `new_client()` with the provider `Referer` | Add any dep beyond `@vidstack/react` + `async-upnp-client` | Expose raw provider URLs, referers, or the signing secret to the client |
| Keep the proxy **closed** — only HMAC-signed, unexpired tokens honored (403 before touching network) | Change the default bind host / widen network exposure | Ship an **open** proxy (arbitrary target URLs) |
| Default bind stays `0.0.0.0` (LAN-reachable, as the committed `serve` already does — casting needs it); documented as trusted-LAN-only, `--host 127.0.0.1` to restrict | Introduce auth, accounts, or persistence | Disable TLS verification anywhere except the existing `new_client()` scraper path |
| Stream responses (never buffer whole videos); support `Range` for MP4 | Swap the player or DLNA library after approval | Add transcoding, DRM circumvention, or public-internet exposure |
| Document the cert-trust step for HTTPS casting | | Commit without explicit user consent (repo git rule) |

---

## Resolved decisions
1. **DLNA scope**: full discovery + push (F5) is **in v1**, alongside Google Cast + AirPlay.
2. **Player entry point**: **one Play button per episode row**.
3. **Token TTL**: **short-lived (a few hours)** — cast sessions survive, stale links expire.
