# Implementation Plan: Aggregator UI/UX build-out

(Supersedes the prior "uvx Packaging" plan, which is in git history and describes shipped work.)

## Overview

Evolve sestudio from a single-source fstream downloader into a personal streaming aggregator, per
`SPEC.md` (product vision) and `docs/RESEARCH-aggregator-ux.md` (research). Work is sliced into
S/M-sized tasks across 6 phases; **the frontend is rebuilt (`npm run build`) at every checkpoint**
so the user can test via `uv run sestudio serve`. Each phase pauses for approval.

## Architecture decisions (locked with user)

- **Watch-state:** localStorage behind a small interface (`watchState.ts`) — swappable to a
  server JSON store later. No database, ever (single-user).
- **Theme:** new custom daisyUI "cinematic dark" theme (near-black cool base, cyan-blue primary,
  coral secondary); **semantic tokens only** everywhere.
- **Playback session:** one shared source of truth for "what's playing + position", fed by the
  browser player and both cast stores — the seam that makes Web↔TV handoff cheap.
- **Browser downloads go through the server** (browser can't send provider Referer/UA): new
  attachment endpoint; MP4 pass-through first, HLS ffmpeg-mux as a separate ask-first task.
- **TMDB** with user-provided key; graceful fallback without it. Match on series_name + year
  (year must stop being discarded at `scraper.py:80`).
- **Boundaries** (SPEC.md §7): no commits without consent; cast/download core is
  regression-critical; no telemetry; sources stay pluggable.

## Dependency graph

```
P0 cast-control tweaks ────────────── (independent quick win)

P1 theme/tokens ──► P1 a11y ──► P1 SeasonTree split ──► P1 ResponsiveModal/mobile ──► P1 PWA
                                        │
P2 identity threading (needs split) ◄───┘
        │
        ├──► P2 watchState store ──► P2 progress capture + resume ──► P2 home rows
        │                                     │
P3 countdown/persistence (independent)        └──► P3 handoff (needs session + cast stores)
        
P4 backend MP4 endpoint ──► P4 frontend toggle ──► P4 HLS mux (ask-first)

P5 config key + year ──► P5 TMDB match/detail/cache ──► P5 catalogs ──► P5 UI enrichment ──► P5 rows
```

High-risk-early: identity threading (T8) touches the play/cast paths — the regression-critical
core — so it's isolated in its own task with explicit cast verification.

---

## Task list

### Phase 0 — Cast-control quick wins (independent; ships first for immediate value)

#### Task 1: Extend seek steps and finer volume step on both cast controllers
**Description:** Extend `SEEK_STEPS` in both controllers from `±10s/±30s/±5m` to
`[-5m,-1m,-30s,-10s,+10s,+30s,+1m,+5m]` (4/4 around play-pause), and change volume slider
`step={0.05}` → `step={0.01}`.
**Acceptance criteria:**
- [ ] Both modals show 8 seek buttons: ±10s, ±30s, ±1m, ±5m
- [ ] Volume sliders move in 1% increments on both
**Verification:** `npm run build && npm run lint`; manual: cast to a device, click each step,
confirm position jumps; drag volume, confirm fine steps.
**Dependencies:** None.
**Files:** `frontend/src/components/DlnaControls.tsx`, `CastControls.tsx`. **Scope:** S

#### Task 2: DLNA mute button + volume up/down buttons
**Description:** Add a mute toggle to `DlnaControls` (Chromecast already has `castToggleMute`).
Check `async-upnp-client` for RenderingControl `SetMute`: if available, add
`POST /api/cast/dlna/mute` in `cast.py` + `dlnaMute()` in `dlnaControl.ts`; else client-side
save-volume→0→restore. Add −/＋ volume nudge buttons (±5%) flanking the DLNA slider via
`dlnaSetVolume`; mirror −/＋ onto Chromecast for parity.
**Acceptance criteria:**
- [ ] DLNA modal has a working mute toggle with correct icon state (mirrors `CastControls.tsx:108-114` markup)
- [ ] −/＋ buttons nudge volume by 5% on both controllers, `aria-label`ed
- [ ] Mute state survives the 2s DLNA status poll (no flicker/fight)
**Verification:** `npm run build && npm run lint`; `uv run pytest tests/` (if backend touched, add a
route test); manual: mute/unmute on a real DLNA renderer, nudge volume.
**Dependencies:** None.
**Files:** `DlnaControls.tsx`, `dlnaControl.ts`, `CastControls.tsx`, possibly
`src/sestudio/web/routers/cast.py` + test. **Scope:** M

### Checkpoint 0
- [ ] Build + lint + pytest green; **rebuild `frontend/dist`**
- [ ] Manual cast session on DLNA + Chromecast: seek steps, 1% volume, mute, nudges
- [ ] User approval before Phase 1

---

### Phase 1 — Foundation & polish (mobile-first + PWA)

#### Task 3: New theme + semantic-token sweep
**Description:** Replace the customized `abyss` block in `index.css` with the "cinematic dark"
theme (SPEC/plan hues). Convert all raw palette utilities to semantic tokens: `ResultsGrid.tsx:20-37`
(violet/blue/rose/yellow/zinc — replace border-color type-coding with a type badge, fixing
color-as-sole-signal), `SeasonTree.tsx:41` `iconBtn`, `App.tsx:99,116-129` header + select-all.
**Acceptance criteria:**
- [ ] `grep -rE "(violet|rose|zinc|yellow|blue)-[0-9]" frontend/src` returns nothing
- [ ] Type distinction (film/anime/series) conveyed by badge text, not border color alone
- [ ] Contrast AA for text tokens on base colors
**Verification:** build + lint; browser MCP screenshot pass, user eyeballs the palette (one-block
tweak if hues disliked).
**Dependencies:** None. **Files:** `index.css`, `ResultsGrid.tsx`, `SeasonTree.tsx`, `App.tsx`,
`ProviderChips.tsx`. **Scope:** M

#### Task 4: a11y fixes on search & grid & tree
**Description:** `SearchBar`: add label/`aria-label`, `catch` surfacing an inline error state,
daisyUI spinner replacing `…`. `SeasonTree`: convert mouse-only clickable `<div>`s
(`:225-242, 270-279, 313-321`) to buttons/keyboard-operable. `ResultsGrid`: `role="status"`
empty-state ("No results for …").
**Acceptance criteria:**
- [ ] Full flow (search → open season → toggle → play) operable by keyboard alone
- [ ] Failed search shows an error message (kill the backend to test)
- [ ] Empty search result shows copy instead of blank space
**Verification:** build + lint; manual Tab-through via browser MCP.
**Dependencies:** T3 (touches same files; avoid conflicts). **Files:** `SearchBar.tsx`,
`SeasonTree.tsx`, `ResultsGrid.tsx`, `App.tsx`. **Scope:** M

#### Task 5: Split SeasonTree
**Description:** Extract `components/season/`: `useSeasonDetail` hook (fetch + lang fallback,
`:99-121`), `EpisodeRow` (dedupe series `:262-281` / film `:305-321`), `LangSwitcher`
(`:244-252`/`:292-300`), `EpisodeRowActions` (from `rowActions` closure `:54-97`). No behavior change.
**Acceptance criteria:**
- [ ] `SeasonTree.tsx` < 200 lines; each extracted file < 150
- [ ] Series and film variants render identically to before (visual diff)
**Verification:** build + lint; manual: open a series and a film, download + play + cast still work.
**Dependencies:** T4. **Files:** `SeasonTree.tsx` + new `season/*` (4 files). **Scope:** M

#### Task 6: Mobile-first responsive + bottom-sheets
**Description:** Shared `ResponsiveModal` wrapper: centered `modal-box` ≥sm, bottom-sheet on small
screens; adopt in all 5 modals (Player, Season, Cast, CastControls, DlnaControls — keep
`useModalBack`). ≥44px touch targets; bulk bar (`App.tsx:146-162`) and cast pills stack cleanly;
safe-area insets + `viewport-fit=cover`.
**Acceptance criteria:**
- [ ] At 320px: no horizontal scroll anywhere; modals are bottom-sheets; all targets ≥44px
- [ ] At ≥768px: modals centered as today
**Verification:** build + lint; browser MCP at 320/768/1024/1440 through the full flow.
**Dependencies:** T5. **Files:** new `ResponsiveModal.tsx`, the 5 modal components, `App.tsx`,
`index.html`. **Scope:** L → if it overruns, split adoption into "wrapper + 2 modals" / "remaining 3".

#### Task 7: PWA
**Description:** `manifest.webmanifest` (name, icons from `fstream.ico`/assets, theme-color,
standalone) + minimal app-shell service worker (**never cache `/api`**), registered in `main.tsx`.
**Acceptance criteria:**
- [ ] Chrome offers install; app opens standalone
- [ ] `/api/*` requests bypass the SW (verify in devtools network)
**Verification:** build; browser MCP: manifest detected, SW registered, no console errors.
**Dependencies:** T3 (theme-color). **Files:** `frontend/public/*`, `main.tsx`, `vite.config.ts`,
`index.html`. **Scope:** S

### Checkpoint 1
- [ ] Build + lint + pytest green; **rebuild `frontend/dist`**
- [ ] 320px walkthrough clean; keyboard-only flow works; PWA installs
- [ ] User approval (incl. theme sign-off) before Phase 2

---

### Phase 2 — Watch-state & library

#### Task 8: Thread episode identity to playback (REGRESSION-CRITICAL)
**Description:** Widen `PlayableEpisode` (`providers.ts:3-7`) with `series_name`, `season`,
`poster_url`, `page_url`, `lang`; populate in `playlistFrom` (`SeasonTree.tsx:45-52`); propagate
through `PlayerModal`, `CastModal`, `castQueue`.
**Acceptance criteria:**
- [ ] Playback and cast still work end-to-end (browser, DLNA, Chromecast)
- [ ] Episode identity available inside `PlayerModal` (visible in React devtools/props)
**Verification:** build + lint; **explicit manual re-verify of the cast+download core loop** (SPEC
boundary).
**Dependencies:** T5. **Files:** `providers.ts`, `SeasonTree.tsx` (or `season/` pieces),
`PlayerModal.tsx`, `CastModal.tsx`, `castQueue.ts`. **Scope:** M

#### Task 9: watchState store + unified playback session
**Description:** `watchState.ts`: localStorage `sestudio.watch.v1`, key
`${series}|S${season}|E${number}`, entries per plan §P2. API: `getProgress`, `saveProgress`,
`markWatched`, `continueWatching()`, `nextUp(series)` + `useWatchState` hook (external-store
pattern like `useCastState`). Include the **playback session** singleton (current episode +
position source) that both player and cast stores will feed.
**Acceptance criteria:**
- [ ] Store round-trips entries; corrupt/missing localStorage degrades to empty (try/catch)
- [ ] ≥90% position marks watched
**Verification:** build + lint; exercise via console in browser MCP.
**Dependencies:** T8 (types). **Files:** new `watchState.ts`, `playbackSession.ts`. **Scope:** S

#### Task 10: Progress capture + resume in player and cast
**Description:** Throttled (~5s) `onTimeUpdate` on `<MediaPlayer>` → `saveProgress`; on source load
seek to saved position with a "Resume from mm:ss / Start over" affordance (respect the
persistent-element pattern `PlayerModal.tsx:34-39`). Subscribe cast stores' `position/duration`
(`cast.ts`, `dlnaControl.ts` poll) → same store.
**Acceptance criteria:**
- [ ] Watch 2 min in browser, reload, reopen episode → resume prompt at the right time
- [ ] Cast progress also lands in the store (check localStorage after casting)
- [ ] Finishing an episode (auto-next) marks it watched
**Verification:** build + lint; manual browser + one cast target.
**Dependencies:** T9. **Files:** `PlayerModal.tsx`, `cast.ts`, `dlnaControl.ts`. **Scope:** M

#### Task 11: Continue Watching / Next Up home rows + watched badges
**Description:** Horizontal poster-row component (reused by P5). Home (no active search) shows
**Continue Watching** (in-progress by `updatedAt`, with progress bar on card) and **Next Up**.
Clicking reopens season → player at the right episode (via stored `page_url` + `lang`). Watched
badge on `EpisodeRow`.
**Acceptance criteria:**
- [ ] Rows appear only when store has entries and search is empty; empty store → clean home
- [ ] Card click lands in the player on the correct episode
- [ ] Rows scroll horizontally on mobile without vertical jank
**Verification:** build + lint; browser MCP walkthrough 320px + desktop.
**Dependencies:** T10. **Files:** new `components/MediaRow.tsx`, `App.tsx`, `season/EpisodeRow`.
**Scope:** M

### Checkpoint 2
- [ ] Build + lint + pytest green; **rebuild `frontend/dist`**
- [ ] Resume + continue-watching + next-up verified on desktop and 320px; cast loop re-verified
- [ ] User approval before Phase 3

---

### Phase 3 — Player upgrades + Web↔TV handoff

#### Task 12: Auto-next countdown + volume/speed persistence
**Description:** Replace silent jump (`PlayerModal.tsx:41-43`) with a 5s "Next: <title> · Cancel"
overlay. Persist player volume + rate in localStorage; restore on mount and across the persistent
element's src swaps.
**Acceptance criteria:**
- [ ] Countdown shows, cancel works, autoplay-off disables it
- [ ] Volume/speed survive reload and episode transitions
**Verification:** build + lint; manual two-episode run.
**Dependencies:** T8. **Files:** `PlayerModal.tsx` (+ small `playerPrefs.ts`). **Scope:** S

#### Task 13: Handoff — browser → TV
**Description:** "Cast to TV" button in `PlayerModal` → target picker (reuse `CastModal` internals)
preloaded with current episode; start cast, seek target to browser position (`dlnaSeek` /
Chromecast seek), pause+close browser player, register cast queue for autoplay-next continuity.
**Acceptance criteria:**
- [ ] Mid-episode handoff resumes on TV within a few seconds of the browser position
- [ ] Cast queue continues the season after handoff
**Verification:** build + lint; manual on DLNA + Chromecast.
**Dependencies:** T9, T10. **Files:** `PlayerModal.tsx`, `CastModal.tsx` (extract picker),
`castQueue.ts`. **Scope:** M

#### Task 14: Handoff — TV → browser (pull back)
**Description:** "Watch here" on `CastControls`/`DlnaControls` → read session position, stop cast,
open `PlayerModal` at that episode+position. Note: DLNA position accuracy varies by renderer —
verify per-target; degrade to nearest-known position.
**Acceptance criteria:**
- [ ] Pull-back opens the browser player at (approx.) the TV position
- [ ] Works from both pills; cast session cleanly stopped
**Verification:** build + lint; manual both targets.
**Dependencies:** T13. **Files:** `CastControls.tsx`, `DlnaControls.tsx`, `App.tsx` (player open
plumbing), `playbackSession.ts`. **Scope:** M

#### Task 15: Verify native multi-track pass-through (doc-only)
**Description:** Confirm `DefaultVideoLayout` surfaces audio/subtitle menus when an upstream HLS
master carries renditions (proxy already rewrites `#EXT-X-MEDIA`, `proxy.py:98-102`). Document in
README. Side-loaded subtitles (OpenSubtitles + `/api/subtitles`) is **deferred — ask first**.
**Acceptance:** finding documented. **Dependencies:** None. **Scope:** XS

### Checkpoint 3
- [ ] Build + lint + pytest green; **rebuild `frontend/dist`**
- [ ] Handoff both directions demoed; countdown + prefs verified
- [ ] User approval before Phase 4

---

### Phase 4 — Flexible downloads

#### Task 16: Backend attachment endpoint (MP4 pass-through)
**Description:** `GET /api/downloads/stream` in `downloads.py`: resolve best provider (reuse
resolve path), fetch upstream with injected Referer/UA (proxy mechanism), stream back as
`StreamingResponse` with `Content-Disposition: attachment; filename="<episode>.mp4"`. HLS returns
501 for now (T18).
**Acceptance criteria:**
- [ ] MP4 episode downloads through the browser with the correct filename
- [ ] Raw upstream URL never appears in the response/headers
- [ ] pytest route test (pytest-httpx mock) for headers + streaming + 501-on-HLS
**Verification:** `uv run pytest tests/`; manual download of a real MP4 title.
**Dependencies:** None (backend-only). **Files:** `downloads.py`, `tests/test_downloads_stream.py`.
**Scope:** M

#### Task 17: Frontend destination toggle
**Description:** **Server / This device** toggle in `ConfirmDownloadModal` (default in
`SettingsPanel`, persisted via existing `/api/settings` — extend `AppConfig` + `SettingsBody`).
"This device" → `<a download>` navigation to T16's endpoint per selected episode; server path
unchanged.
**Acceptance criteria:**
- [ ] Toggle visible, default honored from settings
- [ ] Device download triggers browser download; server download unchanged (SSE queue)
- [ ] HLS-only titles show "device download not yet supported" state (501 handled)
**Verification:** build + lint + pytest (settings roundtrip); manual both destinations.
**Dependencies:** T16. **Files:** `ConfirmDownloadModal.tsx`, `SettingsPanel.tsx`, `api.ts`,
`src/sestudio/config.py`, `settings.py`. **Scope:** M

#### Task 18: HLS → device via ffmpeg mux (ASK FIRST — heavy)
**Description:** For `kind=hls`, spawn bundled ffmpeg (`-c copy` to fragmented MP4/MKV) and stream
stdout chunked to the client; concurrent-job guard; cancellation on client disconnect.
**Acceptance criteria:**
- [ ] HLS episode downloads as a playable file; server CPU bounded (copy, not transcode)
- [ ] Client disconnect kills ffmpeg (no zombie processes)
**Verification:** pytest with a small fixture playlist; manual HLS title; `ps` check after abort.
**Dependencies:** T16, T17, **explicit user go-ahead** (SPEC ask-first). **Files:** `downloads.py`,
`media.py`(?), tests. **Scope:** M

### Checkpoint 4
- [ ] Build + lint + pytest green; **rebuild `frontend/dist`**
- [ ] Both destinations verified; server download path regression-checked
- [ ] User approval before Phase 5

---

### Phase 5 — Discovery & metadata (TMDB)

#### Task 19: Config plumbing + year preservation
**Description:** Add `tmdb_api_key` to `AppConfig` + `SettingsBody` (+ `TMDB_API_KEY` env
override); stop discarding the year in `scraper.py:80` — add `year` to `SeasonCard` (model +
frontend type).
**Acceptance criteria:**
- [ ] Key settable via settings API and env; absent key → feature off, no errors
- [ ] `SeasonCard.year` populated when fstream provides it; existing tests updated
**Verification:** `uv run pytest tests/` (scraper fixtures). **Dependencies:** None.
**Files:** `config.py`, `settings.py`, `scraper.py`, `models.py`, `api.ts`. **Scope:** S

#### Task 20: TMDB matcher + detail endpoint + cache
**Description:** New `/api/tmdb` router (mounted in `app.py:64-69`): `GET /api/tmdb/enrich?title=&year=&kind=`
→ match via TMDB search (series_name+year, fallback title-only) → detail (synopsis, backdrop,
cast top-N, genres, rating, trailer key). Two-layer cache: in-memory + JSON file
(`~/.config/sestudio/tmdb_cache.json`, config.py atomic pattern). HTTP via `http_client.new_client`.
**Acceptance criteria:**
- [ ] Known title enriches correctly; unknown returns 404-style empty (frontend falls back)
- [ ] Second request served from cache (no TMDB hit — assert with pytest-httpx)
- [ ] No key → 503/disabled response, never a crash
**Verification:** pytest with mocked TMDB fixtures. **Dependencies:** T19.
**Files:** new `routers/tmdb.py`, `tmdb.py` (client+matcher), `app.py`, tests. **Scope:** M

#### Task 21: TMDB catalogs (trending / by-genre)
**Description:** `GET /api/tmdb/trending`, `GET /api/tmdb/genre/{id}` returning poster-card lists
(TMDB-shaped; playable only after user searches — cards deep-link to a prefilled search).
**Acceptance criteria:**
- [ ] Endpoints return cached, paginated card lists; disabled cleanly without key
**Verification:** pytest mocked. **Dependencies:** T20. **Files:** `routers/tmdb.py`, tests. **Scope:** S

#### Task 22: Frontend enrichment — cards + title detail header
**Description:** Enrich `ResultsGrid` cards (rating badge, year) via batched enrich calls
(lazy, after render — skeleton shimmer); `SeasonTree` gains a detail header (backdrop, synopsis,
cast strip) with graceful fstream-only fallback.
**Acceptance criteria:**
- [ ] Cards enrich progressively without layout shift; no key → identical to today
- [ ] Season modal shows backdrop/synopsis when matched
**Verification:** build + lint; browser MCP with and without key. **Dependencies:** T20 (+T5).
**Files:** `ResultsGrid.tsx`, `season/` header component, `api.ts`. **Scope:** M

#### Task 23: Browse rows on home
**Description:** Trending + by-genre rows on the empty-search home, reusing `MediaRow` (T11);
row card click → prefills search with the title.
**Acceptance criteria:**
- [ ] Home shows Continue Watching / Next Up / Trending / genre rows in that order
- [ ] Without key: only watch-state rows appear
**Verification:** build + lint; browser MCP 320px + desktop. **Dependencies:** T21, T22, T11.
**Files:** `App.tsx`, `MediaRow.tsx`, `api.ts`. **Scope:** S

### Checkpoint 5 (final)
- [ ] Build + lint + pytest green; **rebuild `frontend/dist`**
- [ ] Full loop: discover → play → resume → handoff → download (both destinations)
- [ ] SPEC.md acceptance ("success looks like") walkthrough with user

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| T8 identity threading breaks play/cast core | High | Isolated task; explicit cast+download manual re-verify; ships alone |
| DLNA renderer quirks (mute, position accuracy) | Med | Feature-detect per target; client-side mute fallback; degrade pull-back to nearest-known position |
| ResponsiveModal adoption regressions (5 modals × `useModalBack`) | Med | Adopt incrementally; split T6 if overrunning; back-button behavior in every modal's manual check |
| HLS device-download server load / zombie ffmpeg | Med | Ask-first task (T18); `-c copy` only; disconnect kills process; concurrency guard |
| TMDB fuzzy match wrong title | Low | Year-assisted match; frontend fallback; cache is per-title correctable later |
| SW caching staleness (PWA) | Low | App-shell only, never `/api`; version-keyed cache bust on build |

## Parallelization

- Safe: T16 (backend) alongside any P1 frontend task; T15 anytime; T19-21 (backend) alongside P3 frontend.
- Sequential: T3→T4→T5→T6 (same files); T8→T9→T10→T11; T13→T14.
- Contract-first: T16's response shape before T17.

## Open questions (carry into checkpoints, don't block start)

1. Branch or `main`? (branch creation was declined earlier — needs an explicit call)
2. T18 (HLS mux) go/no-go — decide at Checkpoint 4.
3. Side-loaded subtitles (OpenSubtitles) — deferred; revisit after Phase 3.
4. Volume −/＋ nudge and 1% step on Chromecast too (assumed yes for parity) — confirm at T2.
