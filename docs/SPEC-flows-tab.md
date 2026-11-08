# Spec: the Flows tab, and flows from a source

> Agreed through mockups, 2026-11-08. The approved boards are
> [`.impeccable/mocks/flows-tab/board.html`](../.impeccable/mocks/flows-tab/board.html) (direction
> **A · Shelf**; B and C on the same board were not picked) and
> [`.impeccable/mocks/flows-tab/from.html`](../.impeccable/mocks/flows-tab/from.html) (sources).
> Open them in a browser at least 1400px wide. They are the visual reference for every PR below.
> Where this text and a board disagree, this text wins.

## 1. Why

- **Clunky.** The tab is two unrelated blocks: a slider panel ("How should it feel now") and a
  grid of same-size cards. On a phone the sliders take the whole first screen.
- **Hard to understand.** A card is a name, an unlabelled line and chips like "1 h · matches
  only", "2 futures", "preset". Nothing says what a flow does or what it will play.
- **No way to aim a flow.** Every flow draws from the whole library. You cannot play a flow over
  one album, one artist, one library or one genre.

## 2. What was decided

| Topic | Decision |
|---|---|
| Layout | **A · Shelf**: one column (max 860px) on desktop and phone. From top to bottom: the playing flow (only while one plays), **From**, **Right now**, **Your flows**, **Starters**. |
| A flow row | Shape (the energy curve, harmony events as dots), name, **one plain sentence** of what it does, the artists it would open with, length, Play, ⋯. Mine also show "made today / yesterday / 3 Nov". |
| Plain sentence | Built from the layers: energy words at the start and end (`calm, easy, lively, high, all out`), the moves between ("up to", "holds", "eases out"), harmony events ("up a fifth halfway"), a genre layer ("Progressive House only"), a tempo change ("slows to 145"). Examples are on the board. |
| Open in place | Clicking a row (not its Play) opens it in place: **Starts with** the first 6 tracks (4 on a phone) from a real render, each with its join tag (In key, Relative, Up a fifth, Break…), then **Another take** (new seed) and **Edit flow** (Copy and edit on a starter). One row open at a time. |
| Playing | While the queue plays a flow: a row on top, outlined in primary, with the shape and a now line (the past dimmed), the current track, "next: X, then up a fifth", Open player. |
| Right now | Replaces the three sliders: five energy words as a segmented choice (Calm / Easy / Lively / High / All out), a tempo stepper (− 172 bpm +), Play. Endless, as today. Mood is not shown until tracks have a mood reading. |
| Starters | The presets. Desktop: one row of chips (mini shape + name) under Your flows; click previews it the way a row opens. Phone: rows like Your flows. ⋯ › Copy makes one yours. The `preset` chip goes. |
| Manage | ⋯ on a row: Rename, Copy, Delete (mine); Copy (starters). |
| Sources | A flow plays **from** one or more sources: a **library, artist, album or genre**. Each source has its own rule: **Only** (nothing from outside it) or **Lean on it** (picked first when it fits the shape; others fill in). Only = solid edge, Lean on it = dashed edge, everywhere. |
| Combining | Sources of the same kind add up (two albums = either). Different kinds narrow each other among the Only ones (library Deadmau5 + album X = X's tracks in that library). Lean on it never removes a track; it ranks. |
| Running out | When Only sources hold less music than the length: **Stop** (the shape is squeezed to what there is) or **Carry on with similar** (the rest is drawn from the whole library, closest first). Default: Stop for an album, Carry on for the rest. |
| From bar | On the Flows tab, above Right now: chips + "Add a source", then one sentence read back: "Only the Deadmau5 library, mostly Progressive House when it fits the shape · 272 tracks, 75 of them Progressive House · enough for 22 h". The sources apply to Right now, every flow and every starter, so every "Starts with" changes. Tap a chip's rule to flip it; × removes it. Kept for the session (localStorage). |
| Add a source | Desktop popover / phone sheet: tabs Genre · Library · Artist · Album, a search field, the list with track counts, **How strictly** (Only · Lean on it, with one line explaining both), Add. Defaults: genre → Lean on it; library, artist, album → Only. |
| Play as a flow | On album, artist and library pages, beside Play and Shuffle. Opens a popover (phone: sheet): the five starter shapes + yours, From prefilled with this page as Only, **Then** (Stop · Carry on with similar), the first tracks in the chosen shape, **Play as Peak**, and **Open in Flows** (takes the sources to the From bar). |
| Other doors | Library rows in the sidebar: "▶ Flow" on hover (phone: in the row's ⋯ menu). Genre chips: a menu with Show these albums (today's click), Play as a flow… (genre as Lean on it), Add to Flows › From. |
| Out of scope | The lanes editor (FlowLanes), the Mixes tab, mood, forks in the From bar, saving sources into a flow (a flow stays a shape; sources belong to the play). |

## 3. Building blocks that already exist (reuse them)

- **Render without playing:** `POST /api/music/flows/{id}/render` and `POST /api/music/flows/render`
  (draft) return `{path, auto, minutes, mix}`; each mix slot has `track_id`, `join`, `fit`,
  `event`, `relaxed`. The open row and the popovers read this.
- **Play:** `POST /api/music/flows/{id}/play` (`playFlow` in `frontend/src/musicFlows.ts`).
- **Genre as a layer:** `flows.py` already has a genre block with `strict: must | prefer`
  (`score()`, around line 190). Lean on it for a genre is the same idea at the pool level.
- **Shapes and words:** `energyShape`, `eventDots`, `eventsLine`, `KINDS` in `musicFlows.ts`;
  `Shape` in `FlowsHome.tsx`; `ENERGY_WORDS` in `FlowsHome.tsx`.
- **Playing state:** `FlowStrip.tsx` reads `q.source` (flow, path, choices) and `forkAhead`.
- **Library data:** `/api/music/libraries/tracks` (title, artist, album, library_label,
  duration) and `/api/music/tracks/summary` (genre, bpm, energy). Genre counts come back from
  `POST /api/music/flows/fits` (`genres`).
- **Detail pages:** `Detail` / `DetailActions` in `views/MusicView.tsx` (album and artist);
  genre chips and the libraries sidebar are in the same file.

## 4. Traps (read before touching anything)

- **The pool has no artist or album.** `_pool()` in `web/routes/music_flows.py` builds the pool
  from `store.get()` (the analysis) plus `library`. The `DownloadedFile` it walks already has
  `artist`, `album`, `title`: keep them on each pool entry, or sources can't filter.
- **Every route that renders must take the sources:** render, draft render, play, mix play and
  **`/queue/reroute`**. The queue's `source` must store them, or a fork, a reroll or Another take
  drops back to the whole library mid-mix.
- **The "repeat" is one song in two files.** Renders show "Supersonic (My Existence)" and
  "idee4.6.1 / Idee4.6.1" back to back: two files, two ids, same song. `render()` only skips
  used ids. Skip used **songs** too (title + artist, case-folded, the same rule as `songKey` in
  `frontend/src/components/music/edit/focus.ts`).
- **"Starts with" costs a render.** Render a row's preview when it opens, not for every row on
  load; cache by (flow, sources, seed) for the session. The artist line on closed rows comes
  from the same cache once rendered, else from the flow's genre layer, else nothing.
- **Endless flows** render two hours (`render_flow`); the "enough for" sentence compares the
  Only sources' total duration with the length (or two hours for Endless).
- **The dial's own flow** (`DIAL_NAME = 'Now'`) stays hidden from the list, as today. Right now
  keeps saving through it.
- **Duplicate names** ("New flow" twice) are real data. Rows tell them apart by date; do not
  rename anything.

## 5. Build plan (PRs)

Files: `frontend/src/components/music/flows/` (`FlowsHome.tsx` rebuilt; new `FlowRow.tsx`,
`FromBar.tsx`, `AddSource.tsx`, `PlayAsFlow.tsx`, `flowWords.ts`), `views/MusicView.tsx` (doors),
`src/sestudio/music/flows.py`, `src/sestudio/music/mixes.py`, `src/sestudio/web/routes/music_flows.py`.

### PR 1: Sources on the server
- Pool entries keep `artist`, `album`, `title`, `library`.
- A `sources` body field on render, draft render, play and mix play:
  `[{kind: library|artist|album|genre, value, rule: only|lean}]` plus `then: stop|similar`.
  Only sources filter the pool (same kind = union, kinds intersect); lean sources add a score
  bonus in `score()` (tunable, start at +1 like the genre block).
  `then: stop` shortens `minutes` to the filtered pool's duration; `similar` renders the filtered
  pool first and fills the rest from the whole pool.
- The queue `source` keeps `sources` and `then`; `/queue/reroute` reuses them.
- `render()` skips a song already used under another id (§4).
- `GET /api/music/flows/sources?kind=` (or the client derives the lists from
  `/libraries/tracks` + summary; pick the cheaper one) for the picker's lists and counts.
- Tests: union / intersect, lean ranks without removing, stop shortens, similar fills, reroute
  keeps sources, no song twice.

### PR 2: The Flows tab as A
- `FlowsHome.tsx` rebuilt: Playing row, Right now (words + tempo), Your flows rows with the plain
  sentence (`flowWords.ts`, with tests), open-in-place with Starts with + Another take + Edit
  flow, Starters chips (desktop) / rows (phone), ⋯ menu. No sources yet.

### PR 3: The From bar and Add a source
- `FromBar.tsx` (chips, rule flip, ×, read-back sentence with counts and hours), `AddSource.tsx`
  (popover on desktop, sheet on a phone), sources kept in localStorage, passed to every render and
  play on the tab.

### PR 4: Play as a flow
- `PlayAsFlow.tsx` popover / sheet on the album, artist and library pages (`DetailActions`, and a
  library page header), From prefilled, Then, first tracks, Play as <shape>, Open in Flows.

### PR 5: The other doors
- "▶ Flow" on library rows in the sidebar (⋯ menu on a phone); the genre chip menu (Show these
  albums, Play as a flow…, Add to Flows › From).

## 6. Checks for every PR

- `uv run pytest` for server PRs; `npm run build` and `npm test` in `frontend/` for frontend
  PRs, rebuilt right away (CLAUDE.md).
- Look at it at 390px and 1280px: `#/music?tab=flows`, an album page, an artist page.
- Play from each door and check the queue holds only what the sources allow; take a fork and
  Another take and check it still does.
- Keyboard: rows, chips, the picker and the popover reachable with Tab, Escape closes, focus
  returns to the button that opened it.

## 7. Sizes

| PR | Size |
|---|---|
| 1 | M (server, most of the logic and tests) |
| 2 | M |
| 3 | M |
| 4 | S |
| 5 | S |
