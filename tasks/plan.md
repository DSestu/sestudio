# Implementation Plan: Revamp Watching Lists (issue #26)

## Overview

Issue #26 asks for three things: batch remove, more meaningful context on saved
items, and more visible actions. Investigation found the underlying causes are
structural rather than cosmetic — four overlapping list concepts (watchlist,
favourites, in-progress, next-up), a `watchlist` that accepts individual
episodes, and per-item controls that are hover-gated and therefore unreachable
on touch.

The revamp collapses four lists into three, makes the two curated lists
title-only, derives a single series-keyed **Watching** list from watch state,
adds a batch-selection mode backed by one transactional endpoint, and gives the
Library a per-tab grid/detail layout toggle. Home's resume surface is rebuilt as
detail rows rather than a poster row.

## Architecture Decisions

Settled during design review (see the conversation that produced this plan):

1. **Watchlist and Favourites hold titles only.** `CollectionEntry` loses `kind`
   and `number`; `refKey` becomes `${series}|S${season}` (`season: 0` = film).
   Rationale: starring an episode produces an intent-free entry in a list that
   means "a show I want to watch". Existing episode entries are folded up to
   their title.

2. **Continue-watching and Next-up merge into one derived `Watching` list keyed
   by series.** Same user intent ("resume this show"); splitting them leaked an
   implementation detail into the UI and caused duplicate posters plus a
   cross-filter hack in `HomeView`.

3. **Server stays a dumb document store.** Every new field is either derived
   client-side or carried verbatim on an existing record, so `library.py` needs
   no schema migration. The only backend additions are one batch endpoint and
   one preference-key whitelist entry.

4. **Layout placement is driven by `@media (hover: hover)`, density by width
   breakpoints.** Conflating them breaks touch tablets, which match `sm:` but
   have no hover.

5. **Selection mode replaces the mobile tab bar** rather than stacking above it.
   Three fixed `z-40` layers already exist (tab bar, Now-Casting bar,
   mini-player); a fourth would push fixed chrome to ~25% of a 568px screen.

6. **Batch mutations go through one transactional endpoint**, so "move to
   favourites" (delete from one list + put to another) cannot half-apply.

7. **One shared detail row serves all three Library tabs and Home.** A per-tab
   layout preference implies every tab supports both layouts, so a generic
   `DetailRow` (poster + meta + actions slot) is built once and composed into
   `WatchingRow` and a title-level variant.

8. **Home's resume surface is detail rows, not a poster row.** The top 3 Watching
   items render as detail rows at the top of Home, with labelled actions and the
   `⋯` sheet, followed by poster rows for Watchlist / Favourites / Trending.
   Home's poster rows carry no per-item actions — Home launches, Library manages.

9. **Vitest is added for the pure logic.** `watching()` is a six-case truth table
   and the migration fold has precedence rules; both are pure and cheap to test,
   and they are the highest-risk logic in this plan.

## Dependency Graph

```
vitest harness (T0) ───────────────────────┐
                                           │
POST /api/library/batch (T1) ──────────────┤
                                           │
watchState.ts: setWatched, dismissedAt,    │
  seasonEpisodes, watching()  (T2) ────────┤
        │                                  │
        ├── collections.ts titles-only ────┤
        │     + 5 call sites (T3)          │
        │           │                      │
        │           └── hydrateLibrary ────┤
        │                 fold+v2 (T4)     │
        │                                  │
        │   MediaCard + ResultsGrid (T5) ──┤
        │           │                      │
        │           ├── ItemActionSheet (T6)
        │           │         │            │
        │           │         └── DetailRow + WatchingRow (T7)
        │           │                   │  │
        │           └── selection state (T10)
        │                     │         │  │
        ├── libraryLayout pref (T8) ────┤  │
        │                     │         │  │
        └─────────────────────┴─────────┴──┤
                    LibraryView + Home (T9)│
                              │            │
                        SelectionBar (T11) ┘
```

Implementation order follows the graph bottom-up. T0 and T1 go first — the two
tasks with automated coverage — so the riskiest logic and the batch contract both
fail fast.

## Vertical Slicing Note

Two tasks are unavoidably type-wide rather than feature-vertical:

- **T3** (collections titles-only) changes a shared TypeScript interface used by
  six files. TypeScript will not compile in an intermediate state, so it cannot
  be split without leaving the tree broken. It is kept atomic and its blast
  radius is enumerated explicitly.
- **T5** (MediaCard extraction) is a refactor that unblocks three later tasks.
  It ships two user-visible bug fixes on its own, so it is not pure overhead.

Every other task delivers one complete path.

## Task List

### Phase 1: Foundation — harness, data model, server

---

## Task 0: Vitest harness

**Description:** Add a test runner to the frontend, which currently has none
(`package.json` has only `dev`/`build`/`lint`/`preview`). This exists so T2 and
T4 can be verified by assertion rather than by browser walkthrough.

**Acceptance criteria:**
- [ ] `npm test` runs vitest in run-once mode and passes
- [ ] One smoke test asserts an existing pure function (e.g. `refKey`) so the harness is proven before it is relied on
- [ ] `npm run lint` still passes with test files present (eslint config covers `*.test.ts`)

**Verification:**
- [ ] `cd frontend && npm test`
- [ ] `cd frontend && npm run build && npm run lint`

**Dependencies:** None

**Files likely touched:**
- `frontend/package.json`
- `frontend/vite.config.ts`
- `frontend/src/collections.test.ts`

**Estimated scope:** S (3 files)

---

## Task 1: Transactional batch mutation endpoint

**Description:** Add `POST /api/library/batch` accepting deletes and puts across
watch state and both collections, applied in a single SQLite transaction.

**Acceptance criteria:**
- [ ] `POST /api/library/batch` accepts `{watch_delete: [], collections_delete: [{list,key}], collections_put: [{list,key,entry}]}`, all fields optional
- [ ] All operations apply in one transaction; an unknown `list` value returns 400 and applies nothing
- [ ] `library.apply_batch()` reuses the existing `_lock` + shared-connection pattern

**Verification:**
- [ ] `uv run pytest tests/web/test_library_route.py -v`
- [ ] New tests cover: mixed batch applies fully; invalid list rolls back; empty batch is a no-op
- [ ] `uv run ruff check . && uv run ruff format --check .`

**Dependencies:** None (parallelizable with T0/T2)

**Files likely touched:**
- `src/sestudio/library.py`
- `src/sestudio/web/routes/library.py`
- `tests/web/test_library_route.py`
- `frontend/src/api.ts` (client wrapper)

**Estimated scope:** S (3–4 files)

---

## Task 2: Watch-state store — reversible watched, new fields, `watching()`

**Description:** Add `dismissedAt` and `seasonEpisodes` to `WatchEntry`, make the
`watched` flag reversible via `setWatched(ep, boolean)`, and add the derived
`watching()` selector. `continueWatching()` and `nextUp()` are left in place so
their consumers keep compiling; they are removed in T9.

**Acceptance criteria:**
- [ ] `setWatched(ep, false)` un-watches, and a subsequent `saveProgress` tick does not re-stick it (the `prev?.watched ?? false` OR at `watchState.ts:83` no longer wins over an explicit manual clear)
- [ ] `dismissSeries(series, season)` sets `dismissedAt`; any later `saveProgress` on that series clears it
- [ ] `watching()` returns one item per `series|Sn`, resolving the resume target per the truth table below, and omits dismissed and finished series

| Latest entry for the series | Result |
|---|---|
| `updatedAt ≤ dismissedAt` | omitted |
| not watched | resume it, `isNextUp: false` |
| watched, `number+1 ≤ seasonEpisodes` | resume `number+1`, `isNextUp: true` |
| watched, `seasonEpisodes` unknown | resume `number+1`, `isNextUp: true` |
| watched, `number+1 > seasonEpisodes` | omitted (season finished) |
| watched film (`season === 0`) | omitted |

*Amended during T2:* row 2 was originally gated on `position ≥ MIN_POSITION`.
Dropped, because `setWatched(ep, false)` rewinds to 0 so the episode can be
offered up again — a MIN_POSITION gate would have hidden the very episode the
user just asked to re-watch. The guard still lives in `saveProgress`, so
playback never produces an entry below the floor anyway.

**Verification:**
- [ ] `cd frontend && npm test` — one test per truth-table row, plus the un-stick case
- [ ] `cd frontend && npm run build && npm run lint`
- [ ] Existing Home/Library views render unchanged (old selectors still in use)

**Dependencies:** T0

**Files likely touched:**
- `frontend/src/watchState.ts`
- `frontend/src/watchState.test.ts`
- `frontend/src/providers.ts` (`seasonEpisodes` on `PlayableEpisode`)
- `frontend/src/views/WatchView.tsx` (record it in `toPlayable`)
- `frontend/src/components/watch/VideoPane.tsx` (`markWatched` → `setWatched`)
- `frontend/src/castQueue.ts` (`markWatched` → `setWatched`)

**Estimated scope:** M (4 files, dense logic)

---

## Task 3: Collections become title-only

**Description:** Drop `kind` and `EntryKind` from `CollectionEntry`, drop
`number` from `CollectionRef`, and simplify `refKey`. Update all five consumers.
`EpisodeList`'s vacated `SaveToggles` slot becomes a watched toggle, which gives
`setWatched` its first manual entry point in the UI.

Atomic by necessity — a shared interface change does not compile in halves.

**Acceptance criteria:**
- [ ] `CollectionEntry` has no `kind`/`number`; `refKey(ref) === `${series}|S${season}``
- [ ] `EpisodeList` rows show a watched toggle (✓, `aria-pressed`) instead of ☆/♥, wired to `setWatched`
- [ ] `ResultsGrid` and `WatchView` save title-level entries; no call site constructs an episode entry

**Verification:**
- [ ] `cd frontend && npm test && npm run build && npm run lint` — zero `tsc` errors
- [ ] Manual: star a title from search → appears once in Library; toggle an episode watched then unwatched in `WatchView` → the ✓ and the playlist progress bar both follow

**Dependencies:** T2

**Files likely touched:**
- `frontend/src/collections.ts`
- `frontend/src/components/SaveToggles.tsx`
- `frontend/src/components/watch/EpisodeList.tsx`
- `frontend/src/components/ResultsGrid.tsx`
- `frontend/src/views/WatchView.tsx`
- `frontend/src/rowItems.tsx`

**Estimated scope:** M–L (6 files, mechanical/type-driven)

---

## Task 4: Fold legacy episode entries up to titles

**Description:** One-time, idempotent migration of `kind:'episode'` collection
entries to their title key, in both the server snapshot and the localStorage
cache. The localStorage key is bumped to `v2` so a stale `v1` cache cannot
reintroduce the old shape after T3.

**Acceptance criteria:**
- [ ] Episode entries collapse to `${series}|S${season}`, deduped; earliest `addedAt` wins, and an existing title entry takes precedence for `addedAt`/`label`
- [ ] Superseded episode keys are removed server-side in one `POST /api/library/batch` call
- [ ] `STORAGE_KEY` is `sestudio.collections.v2`; a `v1` cache is folded on read and `v1` is then discarded
- [ ] Re-running is a no-op (safe on every load)

**Verification:**
- [ ] `cd frontend && npm test` — fold covered by unit tests: dedupe, earliest-`addedAt`, existing-title precedence, idempotence
- [ ] Manual: seed a `v1` localStorage payload with two episode entries and one title entry for the same series, reload → exactly one title entry, no episode keys left in `GET /api/library`; reload again → no further requests
- [ ] `cd frontend && npm run build && npm run lint`

**Dependencies:** T1, T3

**Files likely touched:**
- `frontend/src/hydrateLibrary.ts`
- `frontend/src/collections.ts`
- `frontend/src/collections.test.ts`

**Estimated scope:** S (3 files)

---

### Checkpoint: Foundation (after T0–T4)

- [ ] `pytest` — full suite green (108 on this branch before T1; 113 after)
- [ ] `uv run ruff check . && uv run ruff format --check .`
- [ ] `cd frontend && npm test && npm run build && npm run lint`
- [ ] Live smoke: `GET /api/library` returns title-only collections; no episode keys remain
- [ ] Existing Home/Library/Watch views still work — this phase is invisible to the user by design
- [ ] **Human review before proceeding**

---

### Phase 2: Shared card and mobile visibility

---

## Task 5: Extract `MediaCard`, fix touch visibility, 2-column mobile grid

**Description:** Pull the duplicated card markup out of `MediaRow` and
`PosterGrid` into one component, and apply the same visibility fix to
`ResultsGrid`. Switch action placement on hover capability rather than width:
overlay on hover-capable pointers, inline in the caption otherwise. Drop mobile
grid density to 2 columns so inline ☆/♥ fit, and delete the 24×24 overlay remove
control.

This fixes **two** reported/found mobile bugs. Both stem from hover-gated opacity
at 3-column density (64px of controls on an 88px card = 73%):

| Site | Control | Consequence on touch |
|---|---|---|
| `MediaRow.tsx:48,54` | remove, ☆/♥ | unreachable |
| `PosterGrid.tsx:14,20` | remove, ☆/♥ | unreachable |
| `ResultsGrid.tsx:78` | ☆/♥ | **cannot save a search result** |
| `ResultsGrid.tsx:57` | download-select checkbox | **cannot multi-select for download** |
| `EpisodeList.tsx:105` | (becomes watched toggle in T3) | unreachable |

**Acceptance criteria:**
- [ ] `components/MediaCard.tsx` is the single card implementation; `MediaRow` and `PosterGrid` both consume it
- [ ] Placement switches on `[@media(hover:hover)]`, never on `sm:`/`md:` — verified on a touch viewport ≥768px
- [ ] `PosterGrid` and `ResultsGrid` are `grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6`
- [ ] `ResultsGrid`'s ☆/♥ **and** its download-select checkbox are always visible on touch
- [ ] Nothing interactive is below 32×32px; the `btn-xs btn-circle` remove control is gone (on Watchlist/Favourites, tapping the filled ★ is the removal)
- [ ] Home's poster rows carry no per-item actions (decision 8) — `MediaRowItem.onRemove` and `actions` drop out of the Home path

**Verification:**
- [ ] Manual at 320 / 768 / 1024 / 1440px: ☆/♥ and the download checkbox visible and tappable without hover at 320 and 768; overlay-on-hover on desktop
- [ ] Search → star a result → appears in Library, all on a 320px viewport with no hover
- [ ] Tab through a grid — every control reachable, focus ring visible
- [ ] `cd frontend && npm run build && npm run lint`

**Dependencies:** T3

**Files likely touched:**
- `frontend/src/components/MediaCard.tsx` (new)
- `frontend/src/components/MediaRow.tsx`
- `frontend/src/components/PosterGrid.tsx`
- `frontend/src/components/ResultsGrid.tsx`
- `frontend/src/rowItems.tsx`

**Estimated scope:** M–L (5 files)

---

## Task 6: Item action sheet

**Description:** A `ResponsiveModal`-based action sheet for surfaces needing more
than two actions — Watching in grid layout, and the Watching detail rows in both
Library and Home. Every action is labelled; nothing relies on an icon alone.

**Acceptance criteria:**
- [ ] Sheet lists: Add/remove watchlist, Add/remove favourites, Mark watched, Remove from Watching, Open series — filtered to what applies to the item
- [ ] Opens from one always-visible `⋯` control (≥40px) on Watching surfaces only
- [ ] `useModalBack` wired, so the Android back button closes the sheet; focus moves into the sheet on open and returns to `⋯` on close

**Verification:**
- [ ] Manual at 320px: sheet is a bottom sheet; at 1024px a centered dialog
- [ ] Back button closes it without navigating away
- [ ] Keyboard: Escape closes, Tab stays inside
- [ ] `cd frontend && npm run build && npm run lint`

**Dependencies:** T5

**Files likely touched:**
- `frontend/src/components/library/ItemActionSheet.tsx` (new)
- `frontend/src/components/MediaCard.tsx`

**Estimated scope:** S (2 files)

---

### Checkpoint: Card and visibility (after T5–T6)

- [ ] `cd frontend && npm run build && npm run lint`
- [ ] The issue's "more visible actions" complaint is demonstrably fixed on a real phone — screenshots at 320px in the PR
- [ ] Search-result ☆ and download multi-select both usable on a phone
- [ ] No regression in Home rows
- [ ] **Human review before proceeding**

---

### Phase 3: Detail rows, layout preference, rewire

---

## Task 7: Shared `DetailRow` and `WatchingRow`

**Description:** A generic detail row (poster + meta + actions slot) reused by all
three Library tabs and by Home, plus the `WatchingRow` composition carrying
resume context. Reflows below `sm:` because the single-line layout does not fit
288px.

**Acceptance criteria:**
- [ ] `DetailRow` is generic: poster, title, up to two meta lines, optional progress, an actions slot and an optional `⋯` slot
- [ ] `WatchingRow` composes it with resume context; a title-level variant composes it with ☆/♥ for Watchlist/Favourites detail layout
- [ ] Desktop (≥640px): poster + meta + progress + `[▶ Resume] [✓ Mark watched]` on one row, `⋯` top-right
- [ ] Mobile (<640px): poster (`w-16`) + meta, then full-width progress, then full-width actions; Resume flexes and Mark-watched collapses to an icon with `aria-label`
- [ ] `isNextUp` items read "Up next · S01E05" with a Play action and no progress bar
- [ ] Series context line shows `{watchedCount} of {seasonEpisodes} watched · {relative time}`, degrading gracefully when `seasonEpisodes` is unknown

**Verification:**
- [ ] Manual at 320 / 768 / 1440px — no horizontal body scroll at any width
- [ ] All three variants render: partial, next-up, film (`season: 0`), plus the title-level variant
- [ ] Primary actions measure ≥40px on touch
- [ ] `cd frontend && npm run build && npm run lint`

**Dependencies:** T2, T6

**Files likely touched:**
- `frontend/src/components/library/DetailRow.tsx` (new)
- `frontend/src/components/library/WatchingRow.tsx` (new)
- `frontend/src/rowItems.tsx`

**Estimated scope:** M (3 files, layout-heavy)

---

## Task 8: Per-tab layout preference

**Description:** A `grid | detail` choice per Library tab, persisted server-side
using the established `playlistCollapsed.ts` pattern (localStorage instant cache
→ server write → hydrate). The pref key is validated on both sides, so both
whitelists need the new entry.

**Acceptance criteria:**
- [ ] `libraryLayout.ts` stores `{watching, watchlist, favourites}` with defaults `{detail, grid, grid}` under pref key `library_layout`
- [ ] `_PREF_KEYS` at `routes/library.py:14` and the `putPreference` key union at `api.ts:284` both accept `library_layout`
- [ ] Toggle is two `aria-pressed` buttons in a `join`, icons-only below `sm:`, `aria-label`led
- [ ] The choice survives a reload and appears on a second device

**Verification:**
- [ ] `uv run pytest tests/web/test_library_route.py` — add a case asserting `library_layout` is accepted and an unknown key still 400s
- [ ] Manual: set Watching→grid, reload → still grid; Watchlist unaffected
- [ ] `cd frontend && npm run build && npm run lint`

**Dependencies:** None (parallelizable with T7)

**Files likely touched:**
- `frontend/src/libraryLayout.ts` (new)
- `frontend/src/hydrateLibrary.ts`
- `frontend/src/api.ts`
- `src/sestudio/web/routes/library.py`
- `tests/web/test_library_route.py`

**Estimated scope:** M (5 files)

---

## Task 9: Rewire Library and rebuild Home's resume surface

**Description:** Library becomes three tabs (Watching / Watchlist / Favourites)
honouring the layout pref in both layouts. Home leads with detail rows for the
top 3 Watching items, then poster rows for Watchlist / Favourites / Trending. The
old `continueWatching()`, `nextUp()` and `nextUpItems()` are deleted now that
nothing consumes them. Also fixes a pre-existing a11y gap: the tabs use
`role="tablist"`/`role="tab"` with no arrow-key handling and no `tabpanel`.

**Acceptance criteria:**
- [ ] Library tabs are Watching / Watchlist / Favourites with counts; each renders grid or detail per the pref
- [ ] Home leads with up to 3 Watching detail rows plus a "See all" to Library when there are more; then Watchlist · Favourites · Trending poster rows
- [ ] Home's Watching rows expose labelled actions and the `⋯` sheet; Home's poster rows expose no per-item actions
- [ ] Watching is series-grouped, so a series with several in-progress episodes appears once
- [ ] `continueWatching`, `nextUp`, `nextUpItems` are gone, along with the `cwSeries` cross-filter at `HomeView.tsx:36`
- [ ] Tabs support Left/Right arrow navigation and expose `aria-controls` → `role="tabpanel"`
- [ ] Empty states are per-tab and actionable

**Verification:**
- [ ] Manual: a series with 3 partially-watched episodes shows one entry on Home and one in Library; finishing an episode advances it to next-up; a finished season disappears
- [ ] Home at 320px: 3 detail rows fit without the page feeling like a wall; no horizontal scroll
- [ ] Arrow keys move between tabs; screen reader announces the selected tab and its panel
- [ ] `cd frontend && npm test && npm run build && npm run lint`

**Dependencies:** T2, T7, T8

**Files likely touched:**
- `frontend/src/views/LibraryView.tsx`
- `frontend/src/views/HomeView.tsx`
- `frontend/src/rowItems.tsx`
- `frontend/src/watchState.ts`

**Estimated scope:** M–L (4 files)

---

### Checkpoint: Detail rows and rewire (after T7–T9)

- [ ] `uv run pytest` and `cd frontend && npm test && npm run build && npm run lint`
- [ ] End-to-end: play an episode → appears on Home and in Watching with correct remaining time → mark watched → advances to next up → dismiss → gone until next playback
- [ ] Layout toggle works on all three tabs, both layouts, and persists across devices
- [ ] **Human review before proceeding**

---

### Phase 4: Batch selection

---

## Task 10: Selection state

**Description:** Add selection to `MediaCard` and `DetailRow`, plus a `Select`
toggle in the Library header. In selection mode a card or row tap selects instead
of opening.

**Acceptance criteria:**
- [ ] `Select` enters selection mode; cards and detail rows render a checkbox and the tap target toggles selection rather than opening the title
- [ ] Selection is per-tab and clears on tab change and on exit
- [ ] Selection works in both layouts (grid and detail)
- [ ] Cards expose `role="checkbox"` + `aria-checked`; Space toggles
- [ ] Select-all / select-none available and reflects an indeterminate state

**Verification:**
- [ ] Manual at 320px and 1440px, in both layouts: enter mode, select 3, switch tab → selection cleared; Escape exits
- [ ] Keyboard-only: reach and toggle items without a mouse
- [ ] `cd frontend && npm run build && npm run lint`

**Dependencies:** T5, T9

**Files likely touched:**
- `frontend/src/components/MediaCard.tsx`
- `frontend/src/components/library/DetailRow.tsx`
- `frontend/src/views/LibraryView.tsx`

**Estimated scope:** M (3 files)

---

## Task 11: Selection bar and batch actions

**Description:** The action bar for selection mode, wired to the T1 batch
endpoint with optimistic application and rollback. On mobile it takes the tab
bar's slot rather than stacking, keeping total fixed chrome constant.

**Acceptance criteria:**
- [ ] Bar shows "N selected", Select-all, and per-tab actions: Watchlist/Favourites → `[♥ Move to favourites] [🗑 Remove] [Cancel]`; Watching → `[✓ Mark watched] [🗑 Remove] [Cancel]`
- [ ] On mobile the tab bar is hidden while selection is active and the bar occupies its slot; the Now-Casting bar and mini-player stay put above it, and content padding does not grow
- [ ] All mutations go through one `POST /api/library/batch`; the store applies optimistically and reverts on failure with a visible error
- [ ] Cancel or completing an action restores the tab bar

**Verification:**
- [ ] Manual at 320px with a cast active: bar replaces the tab bar, cast bar unmoved, no content clipped
- [ ] Select 5, Remove → one network request; kill the server and retry → store reverts and an error is shown
- [ ] Verify against `AppShell.tsx:107` (tab bar) and `NowCastingBar.tsx:144` — no `z-40` stacking conflict
- [ ] `cd frontend && npm run build && npm run lint`

**Dependencies:** T1, T10

**Files likely touched:**
- `frontend/src/components/library/SelectionBar.tsx` (new)
- `frontend/src/components/AppShell.tsx`
- `frontend/src/views/LibraryView.tsx`
- `frontend/src/collections.ts`
- `frontend/src/watchState.ts`

**Estimated scope:** M (5 files)

---

### Checkpoint: Complete

- [ ] `uv run pytest` — full suite green
- [ ] `uv run ruff check . && uv run ruff format --check .`
- [ ] `cd frontend && npm test && npm run build && npm run lint`
- [ ] Responsive pass at 320 / 768 / 1024 / 1440px with no horizontal body scroll
- [ ] Keyboard-only pass over Library: tabs, layout toggle, selection, action sheet
- [ ] No console errors; no axe-core violations on Home and Library
- [ ] Every issue #26 requirement demonstrably met: batch remove ✓, meaningful context ✓, visible actions ✓
- [ ] Pre-commit hooks pass (includes the local `frontend-build` hook)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| T3 changes a shared interface across 6 files and cannot compile in halves | Medium | Keep atomic; land it alone with `npm run build` as the gate. Blast radius enumerated in the task. |
| `seasonEpisodes` only populates going forward, so already-finished seasons keep offering a phantom next episode until reopened | Low | Accepted — it is today's behaviour and self-heals on next visit. Documented so it is not mistaken for a bug. |
| Stale `sestudio.collections.v1` localStorage reintroducing `kind`/`number` after T3 | Medium | T4 bumps to `v2` and folds `v1` on read. Covered by unit test and an explicit acceptance criterion. |
| Un-watch being re-stuck by the next `saveProgress` tick (`watchState.ts:83`) | Medium | Explicit T2 acceptance criterion, covered by unit test. |
| Dropping mobile grid to 2 columns halves titles per screen | Low | Deliberate — required for inline controls to fit. The layout toggle gives detail rows as the alternative. |
| Home leading with 3 detail rows pushes Watchlist/Favourites further below the fold on a phone | Low–Medium | Capped at 3 with a "See all"; revisit the cap after the Phase 3 checkpoint with real content. |
| Removing `nextUp` as a distinct row changes a surface users may rely on | Low | The information is preserved, folded into Watching as "Up next" items. |
| T5 grew to include `ResultsGrid`, making it M–L | Low | Justified: `ResultsGrid` has the identical defect in two places, and search is where ☆ is actually used. Split off the `ResultsGrid` half if it overruns. |

## Open Questions

None outstanding. The three that were open are resolved as decisions 7, 8 and 9
above:

- Detail rows are shared across all three tabs (decision 7)
- Home leads with Watching detail rows, not a poster row with `⋯` (decision 8)
- Vitest is adopted as T0 (decision 9)
