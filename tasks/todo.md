# Todo — Aggregator UI/UX build-out

(Supersedes the prior "uvx Packaging" task list, in git history.)

> Task details, acceptance criteria, and verification: `tasks/plan.md`. Product spec: `SPEC.md`.
> Rule: rebuild `frontend/dist` (`npm run build`) at every checkpoint; pause for user approval.

## Phase 0 — Cast-control quick wins
- [x] T1: Seek steps ±10s/±30s/±1m/±5m + 1% volume step (both controllers) (S)
- [x] T2: DLNA mute button + volume −/＋ nudge buttons (M) — native UPnP SetMute via new POST /api/cast/dlna/mute; nudges mirrored to Chromecast
- [ ] **Checkpoint 0**: build/lint/pytest green ✓ (62 passed) · dist rebuilt ✓ · manual cast test (user) · approval

## Phase 1 — Foundation & polish (mobile-first + PWA)
- [x] T3: "Cinematic dark" theme + semantic-token sweep (M) — theme `sestudio-dark`; zero raw palette utilities left
- [x] T4: a11y — SearchBar error/label/spinner, SeasonTree keyboard, grid empty-state (M) — also fixed expand-toggles-all bubbling bug
- [x] T5: Split SeasonTree into components/season/ (M) — 269 lines (shell is the remainder; useSeasonDetail/EpisodeRow/LangSwitcher/EpisodeRowActions extracted)
- [x] T6: ResponsiveModal bottom-sheets + mobile pass (L) — all 6 modals adopted; ≥44px targets via md-on-mobile pattern; safe-area + viewport-fit
- [x] T7: PWA manifest + app-shell SW (never cache /api) (S) — icons generated from favicon.svg; also fixed stale data-theme="abyss" in index.html
- [ ] **Checkpoint 1**: build/lint/pytest green ✓ (62) · dist rebuilt ✓ · desktop visual pass ✓ · **mobile + PWA install: verify on phone (WM blocked resize emulation)** · theme sign-off · approval

## Phase 2 — Watch-state & library
- [x] T8: Thread episode identity to playback ⚠ regression-critical (M) — PlayableEpisode widened (series/season/poster/page_url/lang); single canonical type in providers.ts
- [x] T9: watchState store + playback session (S) — sestudio.watch.v1; playbackSession.ts singleton (browser/chromecast/dlna targets)
- [x] T10: Progress capture + resume (M) — 5s-throttled onTimeUpdate + resume-on-canplay + "Start over"; cast stores feed the same store; castEnded marks watched
- [x] T11: Continue Watching / Next Up rows + watched badges (M) — MediaRow; deep-link opens season → player at episode (autoPlayEpisode), honors stored lang; verified in browser with seeded state
- [ ] **Checkpoint 2**: build/lint/pytest green ✓ · dist rebuilt ✓ · rows + deep-link verified in browser ✓ · **cast loop + real resume: verify manually** · approval

## Phase 3 — Player upgrades + Web↔TV handoff
- [x] T12: Auto-next countdown + volume/speed persistence (S) — 5s overlay w/ Play now · Cancel; playerPrefs.ts
- [x] T13: Handoff browser → TV (M) — ⧉ in player header → CastModal resumeAt; seeks target (DLNA needs ~1.5s settle); onCastStarted closes player
- [x] T14: Handoff TV → browser (M) — "Watch here" on both pills: saves exact cast position → pullback store → PlayerModal auto-resumes; uses cast queue playlist; hidden after page reload (in-memory session)
- [x] T15: Multi-track pass-through documented in README (proxy passes #EXT-X-MEDIA; providers are single-rendition today; side-loaded subs deferred)
- [ ] **Checkpoint 3**: build/lint green ✓ · dist rebuilt · **handoff both ways: verify manually on real devices** · approval

## Phase 4 — Flexible downloads
- [x] T16: Backend GET /api/downloads/stream — MP4 attachment pass-through + 5 tests (M) — token-gated (reuses proxy HMAC), RFC 6266 filename, 501 on HLS, 502 on upstream error
- [x] T17: Destination toggle (Server / This device) + settings default (M) — download_destination in AppConfig/SettingsBody; toggle in ConfirmDownloadModal; sequential <a download>; HLS-only items reported
- [x] T18: ~~HLS → device via ffmpeg mux~~ **superseded** — the streaming remux was
      wrong (browser committed to the download before the server knew it could deliver,
      no progress possible, and the bundled ffmpeg segfaults on mpegts here). HLS device
      downloads now run as a normal server job → `/api/downloads/{id}/file`.
- [x] **Checkpoint 4**: green (83) · dist rebuilt · verified working by user

## Phase 5 — Discovery & metadata (TMDB) — built, **hidden pending a key**
- [x] T19: tmdb_api_key config + stop discarding year (scraper.py:80) (S) — key masked in
      the API (`tmdb_configured` flag only); year survives `Blade Runner 2049 (2017)`
- [x] T20: /api/tmdb enrich — matcher + detail + 2-layer cache + 7 tests (M) — retries
      without the year when a search misses; TLS-verifying client (unlike the scraper's)
- [x] T21: /api/tmdb trending (S)
- [x] T22: Card enrichment (rating/year/poster) + season TitleHeader (backdrop/synopsis/
      cast/trailer) (M)
- [x] T23: Trending row on home, deep-linking into a prefilled search (S)
- [x] **Checkpoint 5**: green (94) · dist rebuilt · **feature hidden at user's request** —
      no settings field; everything is gated on `tmdb_configured`, so it stays invisible
      until `TMDB_API_KEY` is set in the environment

## Open questions
- [x] Branch vs main → working on `refactor/rework_the_interface`, pushed
- [x] T18 HLS mux → superseded by the job-based approach
- [ ] Side-loaded subtitles (OpenSubtitles + /api/subtitles) — still deferred, ask-first
- [x] Chromecast volume nudge/1% parity → applied to both controllers

## Verification still owed by the user (needs real devices)
- [ ] Mobile bottom-sheets + PWA install on a phone (WM blocked resize emulation here)
- [ ] Web↔TV handoff both directions on a real Chromecast / DLNA renderer
- [ ] Resume-after-cast (cast progress landing in the watch store)
