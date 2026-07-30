# Task List — In-browser Player & Cast-to-device

Legend: `[ ]` todo · `[~]` in progress · `[x]` done. See `tasks/plan.md` for phases, dependency graph, and checkpoints.
Do **not** start a task before its dependencies are `[x]`. Stop at each `▸ CHECKPOINT` for human review.

---

## Phase 1 — Backend streaming proxy

### [x] T1 — Proxy token sign/verify helpers
**Goal:** an HMAC-signed, expiring, opaque token that seals `{target_url, referer, provider}` so the proxy is closed.
**Files:** `src/fstream_dl/web/proxy.py` (new); `src/fstream_dl/web/app.py` (add `app.state.proxy_secret = secrets.token_bytes(32)`).
**Steps:**
- `sign(secret, target_url, referer, provider, ttl) -> str`: JSON payload incl. `exp = now + ttl`, HMAC-SHA256, `base64url(payload).base64url(sig)`.
- `verify(secret, token) -> dict`: constant-time (`hmac.compare_digest`) sig check, then `exp` check; raise a typed error on failure. **No network access.**
- `PROXY_TOKEN_TTL = 6 * 3600`.
**Acceptance (SPEC AC7):**
- sign→verify round-trips and returns the original fields.
- Tampered signature → rejected. Expired `exp` → rejected. Neither path performs I/O.
**Verify:** `uv run pytest tests/web/test_stream_proxy.py -k token -q` (new tests: round-trip, tamper, expiry).

### [x] T2 — `resolve` endpoint + MP4 proxy with Range  *(depends: T1)*
**Goal:** complete uqload path — embed → resolved → seekable proxied MP4.
**Files:** `src/fstream_dl/web/routes/stream.py` (new); `web/app.py` (stash `app.state.providers = _PROVIDERS`; `include_router(stream.router, prefix="/api")`).
**Steps:**
- `GET /api/stream/resolve?embed_url=&provider=`: `asyncio.to_thread(provider.get_stream_url, embed_url)`; classify `kind` = `"hls"` if `.m3u8` in URL else `"mp4"`; return `{proxy_url: "/api/stream/proxy?token=" + sign(...), kind}`. Provider failure → `HTTPException(502, str(exc))`.
- `GET /api/stream/proxy?token=`: `verify` (403 on failure); forward client `Range` header upstream via `new_client().stream("GET", url, headers={Referer, Range?})`; relay status (200/206), `Content-Type`, `Content-Range`, `Accept-Ranges`, `Content-Length`; body via `StreamingResponse`.
**Acceptance (SPEC AC1, AC3, AC4, AC7):**
- uqload embed → `kind:"mp4"` + `proxy_url` (AC1). Provider error → 502 (AC3).
- Proxy relays a `Range` request as 206 with correct `Content-Range` (AC4).
- Bad/expired token → 403, no upstream call (AC7).
**Verify:**
- Unit: `respx`-mock an upstream MP4; assert Range forwarded + 206 relayed; assert 403 path issues no request.
- Manual: `curl -s "http://127.0.0.1:8080/api/stream/resolve?...&provider=uqload"` then `curl -r 0-1023 "<proxy_url>" -o /dev/null -D -` shows `206` + `Content-Range`; `ffprobe "<proxy_url>"` reports a valid video.

### [x] T3 — HLS proxy + playlist/key rewriting  *(depends: T1, T2 · parallel: T6)*
**Goal:** complete vidzy/netu path — resolved `.m3u8` served so the client only ever talks to `/api/stream/proxy`.
**Files:** `src/fstream_dl/web/proxy.py` (add `rewrite_playlist(text, base_url, referer, provider, mint_token) -> str`); `routes/stream.py` (branch proxy on content: if playlist, fetch fully, rewrite, return `application/vnd.apple.mpegurl`; else stream bytes as in T2).
**Steps:**
- Detect playlist by `#EXTM3U` / `.m3u8` target. Resolve every URI against the playlist's absolute base (`urllib.parse.urljoin`): segments (`.ts`/`.m4s`/fMP4 init), nested playlist URIs (master→media), and `#EXT-X-KEY:...URI="..."` and `#EXT-X-MAP:URI="..."`. Replace each with `/api/stream/proxy?token=<fresh sign()>`. Preserve `#EXT-X-BYTERANGE` lines untouched (byte-range handled by the MP4/Range path).
- Handle both relative and absolute source URIs.
**Acceptance (SPEC AC2, AC5, AC6):**
- vidzy/netu embed → `kind:"hls"` (AC2).
- Master playlist rewritten so variants + segments load only via proxy (AC5).
- `#EXT-X-KEY URI` rewritten; key fetched through proxy (AC6).
**Verify:**
- Unit: fixtures = captured real vidzy + netu playlists (master, media, AES-128, relative + absolute). Assert every URI points at `/api/stream/proxy?token=`; assert non-URI lines unchanged.
- Manual: `ffprobe`/`ffplay "<hls proxy_url>"` plays; `curl "<hls proxy_url>"` shows only proxied URIs.

> ▸ **CHECKPOINT A** — Backend proxy verified for MP4 (seekable) + HLS (rewritten) via curl/ffprobe; `uv run pytest tests/web/test_stream_proxy.py -q` green; `uv run ruff check .` clean. **Get human approval before Phase 2.**

---

## Phase 2 — In-browser player

### [x] T4 — Vidstack player modal + per-row Play button  *(depends: T2, T3)*
**Goal:** click Play on any episode row → it plays in a modal.
**Files:** `frontend/package.json` (+`@vidstack/react`); `frontend/src/api.ts` (`resolveStream(embedUrl, provider) -> {proxy_url, kind}`); `frontend/src/components/PlayerModal.tsx` (new); `frontend/src/components/SeasonTree.tsx` (add a Play button per row, both series + film branches, next to the existing "open on fstream" link).
**Steps:**
- Play button picks the provider the same way `handleDownload` does (`uqload` → `vidzy` → `netu` → first). Opens `PlayerModal` with `{embedUrl, provider, title}`.
- `PlayerModal`: call `resolveStream`, feed Vidstack `<MediaPlayer src={{src: proxy_url, type: kind==='hls' ? 'application/x-mpegurl' : 'video/mp4'}}>`. Show a spinner while resolving, an error state on 502.
- On close: unmount player (tears down MSE) and abort the resolve fetch (`AbortController`).
- Follow the ref-pattern for any effect deps (see SearchBar/SettingsPanel) to satisfy `exhaustive-deps`.
**Acceptance (SPEC AC8, AC9):**
- Play → playback in modal; close → network quiets (AC8).
- Works for an uqload (MP4) and a vidzy (HLS) episode (AC9).
**Verify:** `npm run build` + `npm run lint` clean; manual — `serve`, search a known series, Play one MP4-backed and one HLS-backed episode; DevTools Network shows requests only to `/api/stream/proxy`; close modal → requests stop.

> ▸ **CHECKPOINT B** — In-browser playback works for both stream kinds; traffic confined to the proxy. **Get human approval before casting.**

---

## Phase 3 — LAN / HTTPS enablement

### [x] T7 — HTTPS/LAN posture + Caddy docs  *(depends: — · parallel: T4)*
**Goal:** the app reachable over trusted HTTPS on the LAN IP, so cast devices can fetch the proxy.
**Files:** `README.md` (or `docs/`) new "Watch & cast on your network" section; possibly `cli.py` serve host default.
**Steps:**
- **Resolve the host-binding decision** (see plan Risks): reconcile `cli.py:146` default (`0.0.0.0`) vs SPEC boundary (`127.0.0.1`). Recommend: keep `--host` explicit, document `--host 0.0.0.0` for casting, and update the SPEC boundary wording to match whatever is chosen. **Ask the user.**
- Document `caddy reverse-proxy --from https://<lan-ip> --to 127.0.0.1:8080` and the **cert-trust step** (install/trust Caddy's local CA on the casting device) — the known Chromecast blocker.
**Acceptance (SPEC AC14):** docs take a user from `serve --host 0.0.0.0` + Caddy to a working HTTPS origin, with the Chromecast cert-trust step called out.
**Verify:** follow the doc on a second device: `https://<lan-ip>` loads the UI with a trusted cert; the in-browser player still works over HTTPS.

> ▸ **CHECKPOINT C-pre** — App served over trusted HTTPS on the LAN. Required before AC10/AC11.

---

## Phase 4 — Casting

### [x] T5 — Google Cast + AirPlay buttons  *(depends: T4, T7 · parallel: T8)*
**Goal:** cast the currently-playing stream to a Chromecast / AirPlay device from the player.
**Files:** `frontend/src/components/PlayerModal.tsx` (add Vidstack Google Cast + AirPlay buttons/menu items).
**Steps:** enable Vidstack's `<GoogleCastButton>` / AirPlay support; ensure the media `src` is the absolute HTTPS `proxy_url` (cast devices resolve it themselves — must not be a relative path).
**Acceptance (SPEC AC10, AC11):**
- Over trusted HTTPS on LAN, Cast button lists a Chromecast and casting plays on it (AC10).
- AirPlay button casts in Safari on the same network (AC11, best-effort).
**Verify:** manual on real devices over HTTPS (needs T7). Document result in the checklist.

### [x] T6 — DLNA backend (discovery + play)  *(depends: T2 · parallel: T3, T4)*
**Goal:** discover LAN MediaRenderers and push a proxy_url to one.
**Files:** `pyproject.toml` (+`async-upnp-client`); `src/fstream_dl/dlna.py` (new: SSDP discovery + `SetAVTransportURI`+`Play`); `src/fstream_dl/web/routes/cast.py` (new); `web/app.py` (register router).
**Steps:**
- `GET /api/cast/dlna/renderers`: SSDP-discover `MediaRenderer`s (bounded timeout, return partial on slow networks) → `[{name, udn, control_url}]`, via `asyncio.to_thread`/async client.
- `POST /api/cast/dlna/play` `{renderer_udn, proxy_url}`: build absolute URL (LAN IP, HTTP is fine for DLNA), send `SetAVTransportURI` then `Play`.
**Acceptance (SPEC AC12, AC13):**
- `/renderers` lists a real renderer (AC12).
- `/play` starts playback of the proxied stream on it (AC13).
**Verify:** unit — mock SSDP description + assert well-formed `SetAVTransportURI` SOAP body. Manual — list a real TV and play to it.

### [x] T8 — DLNA "Cast to TV" menu (frontend)  *(depends: T6, T4 · parallel: T5)*
**Goal:** pick a discovered renderer from the UI and push the episode to it.
**Files:** `frontend/src/api.ts` (`listRenderers()`, `dlnaPlay(udn, proxyUrl)`); `frontend/src/components/CastMenu.tsx` (new); wire into the episode row / player.
**Steps:** a "Cast to TV" control on the row (or in the player) that lists renderers and, on select, resolves the stream (reuse `resolveStream`) and calls `dlnaPlay` with the absolute proxy_url.
**Acceptance (SPEC AC13):** selecting a renderer starts playback of the proxied stream on that device.
**Verify:** `npm run build`/`lint` clean; manual — cast an episode to a real TV from the UI.

> ▸ **CHECKPOINT C** — Full device matrix on real hardware: Chromecast (HTTPS), AirPlay (Safari), DLNA (TV). Record pass/fail per device. **Ship.**

---

## Definition of done (whole feature)
- All unit tests green (`uv run pytest`), `ruff` + `eslint` clean, `npm run build` succeeds.
- Manual device matrix (Checkpoint C) recorded.
- SPEC boundaries upheld: proxy stays closed (signed+expiring tokens), no raw provider URLs/secrets reach the client, TLS-verify-off confined to `new_client()`.
- No commit without explicit user consent (repo git rule).
