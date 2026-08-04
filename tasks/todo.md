# Todo: Revamp Watching Lists (issue #26)

Full detail, acceptance criteria and verification steps: [plan.md](plan.md)

Branch: `feat/watching-lists-26` (off `origin/main`). **Nothing committed.**

## Phase 1: Foundation — harness, data model, server

- [x] **T0** Vitest harness — `npm test`, config, in-memory `Storage` stub,
      smoke tests on `refKey`. *vitest 4.1.10.*
- [x] **T1** `POST /api/library/batch` — transactional deletes/puts, client
      wrapper `batchLibrary` that throws so callers can roll back.
- [x] **T2** Watch-state store — `dismissedAt`, `seasonEpisodes`,
      `watchedCleared`, reversible `setWatched`, `dismissSeries`, `watching()`.
- [x] **T3** Collections title-only — `kind`/`number` gone, 6 call sites updated,
      `EpisodeList` gained a watched toggle.
- [x] **T4** `foldToTitles` + localStorage `collections.v2`; server-side fold in
      one batch request at hydration. Idempotent.

### ✅ Checkpoint: Foundation — automated gates pass
- [x] `pytest` green · `ruff check` clean
- [x] `npm test` / `build` / `lint` clean
- [x] No stray `collections.v1` references beyond the legacy constant

## Phase 2: Shared card and mobile visibility

- [x] **T5** `MediaCard` extracted; placement switched to
      `@media(hover:hover)`; 2-column mobile grids; 24px remove control gone.
      **Also fixed `ResultsGrid`** — ☆/♥ *and* the download-select checkbox.
- [x] **T6** `ItemActionSheet` on `ResponsiveModal`, with `useModalBack`,
      Escape, and focus-on-open.

### ✅ Checkpoint: Card and visibility
- [x] Build/lint clean
- [ ] **Manual: not done** — needs a real phone / device toolbar at 320px, plus
      PR screenshots

## Phase 3: Detail rows, layout preference, rewire

- [x] **T7** `DetailRow` (generic) + `WatchingRow` + `TitleRow` +
      `WatchingOverflow` + `watchingLabels`.
- [x] **T8** `libraryLayout.ts`, both pref whitelists, `LayoutToggle`,
      `library_layout` added to the server snapshot and bulk import.
- [x] **T9** Library = 3 tabs × 2 layouts + tablist arrow keys + `tabpanel`;
      Home leads with ≤3 Watching detail rows + See all; `continueWatching`,
      `nextUp`, `nextUpItems` and the `cwSeries` cross-filter deleted.

### ✅ Checkpoint: Detail rows and rewire
- [x] `pytest` / `npm test` / `build` / `lint` clean
- [ ] **Manual: not done** — end-to-end resume → watched → next-up → dismiss

## Phase 4: Batch selection

- [x] **T10** Selection in `MediaCard` and `DetailRow` (`role="checkbox"`,
      Space toggles); `Select` toggle; per-tab, cleared on tab change; works in
      both layouts.
- [x] **T11** `SelectionBar` wired to the batch endpoint with optimistic apply
      and rollback; `selectionMode` store lets `AppShell` yield the tab bar's
      slot rather than stacking.

### ✅ Checkpoint: Complete
- [x] `pytest` — 116 passed · `ruff check` clean · format clean on touched files
- [x] `npm test` — 36 passed · `build` clean · `lint` clean
- [ ] **Manual: not done** — responsive pass at 320/768/1024/1440, keyboard-only
      pass, console errors, axe-core
- [ ] Pre-commit hooks not run (`scripts/build-frontend.sh` needs `npm` on PATH;
      it is only reachable here via `nix-shell -p nodejs`)

## Deviations from the plan

| # | Change | Why |
|---|---|---|
| T2 | Truth-table row 2 lost its `position ≥ MIN_POSITION` gate | Un-watching rewinds to 0; the gate would hide the episode just asked for |
| T2 | `seasonEpisodes` went on `PlayableEpisode`, set in `WatchView.toPlayable`, not `VideoPane` | `VideoPane` holds one episode; `toPlayable` has the whole playlist |
| T2 | Stores the **highest episode number**, not the count | A sparse playlist would otherwise look like an early season end |
| T5 | Grew to cover `ResultsGrid` | Identical defect in two places, and search is where ☆ is used |
| T6 | `sheetIcon` split into `sheetIcons.tsx`; `watchingContext`/`episodeLabel` into `watchingLabels.ts` | `react-refresh/only-export-components` forbids non-component exports |
| T8 | `library_layout` added to `get_snapshot` and `import_bulk` | Hydration needs it in the snapshot; `test_get_library_empty` updated |
| T11 | Batch endpoint extended with `watch_put` (+2 tests) | So bulk Remove on Watching is the same reversible dismiss as the single-item action, instead of a destructive delete |
| T11 | New `selectionMode.ts` store | `AppShell` is nowhere near `LibraryView` in the tree |

## New files

`MediaCard.tsx` · `library/{DetailRow,WatchingRow,TitleRow,WatchingOverflow,
ItemActionSheet,LayoutToggle,SelectionBar,sheetIcons}.tsx` ·
`library/watchingLabels.ts` · `libraryLayout.ts` · `selectionMode.ts` ·
`test-setup.ts` · 4 test files
