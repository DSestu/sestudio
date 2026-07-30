# Implementation Plan — In-browser Player & Cast-to-device

Source of truth: `SPEC.md` → section "SPEC: In-browser Player & Cast-to-device" (Approved).
Decisions locked: DLNA in v1 · one Play button per episode row · short-lived (few-hour) token TTL.

This plan slices the work **vertically** — each task delivers one complete, verifiable path (resolve → proxy → play/cast), not a horizontal layer. Tasks are independently shippable and land behind no feature flag; the UI affordance only appears once its backing path works.

---

## Dependency graph

```
                       ┌─────────────────────────┐
                       │ T1 proxy.py: token       │  (HMAC sign/verify, TTL)
                       │    sign/verify helpers    │
                       └────────────┬─────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────┐         ┌──────────────────┐        ┌──────────────────┐
│ T2 resolve +  │         │ T3 proxy: HLS    │        │ T6 DLNA backend  │
│ MP4 proxy      │◀───────│ playlist rewrite  │        │ (dlna.py+cast.py)│  ← needs a proxy_url
│ (uqload path)  │  reuse  │ (vidzy/netu path)│        │  from T2/T3      │
└───────┬───────┘         └────────┬─────────┘        └────────┬─────────┘
        │                          │                           │
        └────────────┬─────────────┘                           │
                     ▼                                          │
          ┌─────────────────────┐                              │
          │ T4 Vidstack player   │                              │
          │ modal + per-row Play │                              │
          └──────────┬──────────┘                              │
                     │                                          │
        ┌────────────┴───────────┐                             │
        ▼                        ▼                             ▼
┌────────────────┐     ┌────────────────────┐      ┌────────────────────┐
│ T7 HTTPS/LAN   │────▶│ T5 GCast + AirPlay │      │ T8 DLNA "Cast to   │
│ (Caddy + host) │needs│ buttons (client)   │      │ TV" menu (frontend)│
└────────────────┘     └────────────────────┘      └────────────────────┘
```

**Critical path:** T1 → T2 → T3 → T4 (in-browser playback). Casting (T5/T8) branches off after the player and HTTPS exist. DLNA backend (T6) can proceed in parallel with the player once T2 lands.

**Parallelizable:** After T2, {T3} and {T6} are independent. After T4, {T5+T7} and {T8} are independent.

---

## Shared design notes (apply to all backend tasks)

- **Token** (`web/proxy.py`): opaque, URL-safe, `HMAC-SHA256` over a JSON payload `{u: target_url, r: referer, p: provider, exp: <unix>}`. Secret generated per-process at startup and stored on `app.state.proxy_secret` (`secrets.token_bytes(32)`). Verify rejects bad signature **or** `exp < now` with `HTTPException(403)` **before** any network call. TTL from the SPEC = a few hours (propose `PROXY_TOKEN_TTL = 6 * 3600`).
- **Provider access**: `_PROVIDERS` in `web/app.py` is currently only handed to `JobStore`. Also stash it on `app.state.providers` so `routes/stream.py` can resolve without duplicating the registry.
- **Upstream fetches**: every proxy/DLNA upstream call uses `http_client.new_client()` (TLS-verify-off + Referer). Never a bare `httpx.Client`.
- **Blocking I/O**: provider `get_stream_url()` and DLNA SSDP/SOAP are blocking → wrap in `asyncio.to_thread`, matching `routes/seasons.py`.
- **Streaming**: proxy uses `fastapi.responses.StreamingResponse` with an `httpx` streaming request (`client.stream(...)`); never read the whole body into memory.

---

## Phases & checkpoints

### Phase 1 — Backend streaming proxy (T1 → T2 → T3)
The keystone. Nothing downstream works without it, and it's the part where correctness lives, so it's built and unit-tested first, verified with `curl`/`ffprobe` before any UI.
**▸ Checkpoint A** (human review): proxy serves both a seekable MP4 and a fully-rewritten HLS stream via `curl`/`ffprobe`; unit tests green. Approve before touching the frontend.

### Phase 2 — In-browser player (T4)
**▸ Checkpoint B** (human review): clicking Play on one uqload episode and one vidzy episode plays in the browser modal; network tab shows traffic only to `/api/stream/proxy`. Approve before casting work.

### Phase 3 — LAN/HTTPS enablement (T7)
Reconcile the host-binding default and document the Caddy HTTPS path. Required before Google Cast/AirPlay can be verified.
**▸ Checkpoint C-pre**: app reachable over trusted HTTPS on the LAN IP.

### Phase 4 — Casting (T5, T6, T8)
Google Cast + AirPlay buttons (T5), DLNA backend (T6, can start in Phase 1/2 in parallel), DLNA menu (T8).
**▸ Checkpoint C** (human review, needs real devices): full device matrix — Chromecast over HTTPS, AirPlay in Safari, DLNA to a TV. Ship.

---

## Task summaries
Full acceptance criteria + verification steps live in `tasks/todo.md`. Each task cites the SPEC acceptance criteria (AC1–AC14) it satisfies.

| # | Task | SPEC ACs | Depends on | Parallel with |
|---|------|----------|-----------|---------------|
| T1 | Token sign/verify helpers (`web/proxy.py`) | AC7 | — | — |
| T2 | `resolve` endpoint + MP4 proxy (Range) | AC1, AC3, AC4, AC7 | T1 | — |
| T3 | HLS proxy + playlist/key rewriting | AC2, AC5, AC6 | T1, T2 | T6 |
| T4 | Vidstack player modal + per-row Play | AC8, AC9 | T2, T3 | — |
| T5 | Google Cast + AirPlay buttons | AC10, AC11 | T4, T7 | T8 |
| T6 | DLNA backend (discovery + play) | AC12, AC13 | T2 | T3, T4 |
| T7 | HTTPS/LAN posture + Caddy docs | AC14 | — | T4 |
| T8 | DLNA "Cast to TV" menu (frontend) | AC13 | T6, T4 | T5 |

---

## Risks & mitigations
- **HLS rewriting edge cases** (relative vs absolute URIs, `#EXT-X-KEY`, nested master→media, byte-range `#EXT-X-BYTERANGE`) → capture real vidzy + netu playlists as fixtures in T3; unit-test each shape. Highest-risk task.
- **Open-proxy abuse** → closed by construction (T1 signed+expiring tokens; 403 before network). Verified in T1/T2 tests.
- **Chromecast cert trust** → the known blocker from prior Caddy work (memory S1890/S1891). T7 documents installing/trusting the Caddy local CA on the casting device; without it AC10 cannot pass.
- **Host-binding contradiction**: `cli.py:146` already defaults `serve --host 0.0.0.0`, but the SPEC boundary says default should stay `127.0.0.1`. **Decision needed in T7** — either update the SPEC boundary to accept `0.0.0.0` (casting needs LAN) or change the default and require an explicit `--host` opt-in. Flagged, not silently resolved.
- **DLNA library surface** → `async-upnp-client` SSDP can be slow/flaky on some networks; T6 sets a discovery timeout and returns partial results rather than blocking.

---

## Out of scope (per SPEC non-goals)
Transcoding · auth/multi-user · watch-history/resume · public-internet exposure.
