# Todo — Aggregator UI/UX build-out

(Supersedes the prior "uvx Packaging" task list, in git history.)

> Task details, acceptance criteria, and verification: `tasks/plan.md`. Product spec: `SPEC.md`.
> Rule: rebuild `frontend/dist` (`npm run build`) at every checkpoint; pause for user approval.

## Phase 0 — Cast-control quick wins
- [x] T1: Seek steps ±10s/±30s/±1m/±5m + 1% volume step (both controllers) (S)
- [x] T2: DLNA mute button + volume −/＋ nudge buttons (M) — native UPnP SetMute via new POST /api/cast/dlna/mute; nudges mirrored to Chromecast
- [ ] **Checkpoint 0**: build/lint/pytest green ✓ (62 passed) · dist rebuilt ✓ · manual cast test (user) · approval

## Phase 1 — Foundation & polish (mobile-first + PWA)
- [ ] T3: "Cinematic dark" theme + semantic-token sweep (M)
- [ ] T4: a11y — SearchBar error/label/spinner, SeasonTree keyboard, grid empty-state (M)
- [ ] T5: Split SeasonTree into components/season/ (M)
- [ ] T6: ResponsiveModal bottom-sheets + 320px mobile pass (L — split if overrunning)
- [ ] T7: PWA manifest + app-shell SW (never cache /api) (S)
- [ ] **Checkpoint 1**: green · rebuild · 320px + keyboard + PWA install · theme sign-off · approval

## Phase 2 — Watch-state & library
- [ ] T8: Thread episode identity to playback ⚠ regression-critical (M)
- [ ] T9: watchState store + playback session (S)
- [ ] T10: Progress capture + resume (player + cast stores) (M)
- [ ] T11: Continue Watching / Next Up rows + watched badges (M)
- [ ] **Checkpoint 2**: green · rebuild · resume/rows verified · cast loop re-verified · approval

## Phase 3 — Player upgrades + Web↔TV handoff
- [ ] T12: Auto-next countdown + volume/speed persistence (S)
- [ ] T13: Handoff browser → TV at current position (M)
- [ ] T14: Handoff TV → browser (pull back) (M)
- [ ] T15: Verify+document native multi-track pass-through (XS)
- [ ] **Checkpoint 3**: green · rebuild · handoff both ways demoed · approval

## Phase 4 — Flexible downloads
- [ ] T16: Backend GET /api/downloads/stream — MP4 attachment pass-through + tests (M)
- [ ] T17: Destination toggle (Server / This device) + settings default (M)
- [ ] T18: HLS → device via ffmpeg mux ⚠ ask-first (M)
- [ ] **Checkpoint 4**: green · rebuild · both destinations verified · T18 go/no-go · approval

## Phase 5 — Discovery & metadata (TMDB)
- [ ] T19: tmdb_api_key config + stop discarding year (scraper.py:80) (S)
- [ ] T20: /api/tmdb enrich — matcher + detail + 2-layer cache + tests (M)
- [ ] T21: /api/tmdb trending + genre catalogs (S)
- [ ] T22: Card enrichment + season detail header (backdrop/synopsis/cast) (M)
- [ ] T23: Trending/genre browse rows on home (S)
- [ ] **Checkpoint 5 (final)**: green · rebuild · full-loop walkthrough vs SPEC · done

## Open questions
- [ ] Branch vs main (branch creation declined earlier — needs explicit call)
- [ ] T18 HLS mux go/no-go (decide at Checkpoint 4)
- [ ] Side-loaded subtitles (deferred; revisit post-Phase 3)
- [ ] Chromecast volume nudge/1% parity (assumed yes; confirm at T2)
