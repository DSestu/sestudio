# Spec: blend playlists (one object for playlists, the set and mixes)

Status: approved 2026-11-21 (defaults 1–3 confirmed). Mockup: `.impeccable/mocks/mix-phone/blend.html` (D1–D3 desktop, P1–P4 phone).
Supersedes: the set lane (SPEC-music-library §2.6), the mix view and Mixes list (SPEC-music-flows §7).

## 1. Why

The critique of the Music board and the mix view (20/40, `.impeccable/critique/`) found three objects that do almost the same thing: playlists (hand lists), Your set (a tray ordered by Best blend) and mixes (made by a flow, with pins). The mix view was a generic list outside the board, re-rendered for 8–14 s with no feedback, and one pin reshuffled 9 rows.

## 2. Decisions (the user's answers, 2026-11-21)

| Topic | Decision |
|---|---|
| One object | A mix is a **playlist in blend mode**. No separate Mixes list, no Your set tray. |
| Order | **Blend orders it, your pins win.** Same engine as Best blend today (`builder.order_set`, Blend by, Harmony moves, shape). |
| Drop | A dropped or dragged track is **always pinned where it lands**. |
| Stay put | Re-ordering keeps rows where they are unless moving them clearly helps: a **stay-put cost** in `order_set` (§4.1). A pin moves 1–3 neighbours, not the whole list. **Re-blend all** (in ⋯) ignores the cost once. |
| When it re-orders | **Live while editing, locked on Play.** Every edit (add, remove, pin, move, swap, shape, Blend by, fill) re-orders at once. Pressing Play locks the order: what you see is what plays. An edit while it plays re-blends only the rows after the playing one. |
| Flows | A flow can **add tracks** (Fill from a flow: flow + 15 min / 30 min / 1 h) **and shape the order** ("Use its shape": the flow's energy curve becomes the shape). Pins always win. |
| Where | Built **in the board**: the open playlist takes the centre's lower half (where Your set was), the tape stays above as the source, the right column follows the selected row or join. |
| Hand order | Blend off = **Hand order**: the current order freezes and nothing moves on its own. Existing playlists open in Hand order; switching one to Blend re-orders it (Undo). |
| Queue | Playing a blend playlist puts **its tracks** in the queue (not a block), replacing what is after the playing track, as Play the set does today. |
| Existing mixes | Become blend playlists: the mix's current rendered tracks, its pins kept as pins, its flow as the shape. (confirmed 2026-11-21) |

## 3. Screens (from the mockup)

### 3.1 Desktop (D1–D3)

- **Explorer**: Playlists section lists blend playlists (gradient glyph) and hand ones (outline glyph). The **Mixes** section goes. **Flows** stay, labelled "fill a playlist"; clicking one still opens the flow editor.
- **Centre**: tape on top (unchanged). Under it, the open playlist:
  - Header: name, `n tracks · length · blend score · k rough joins`; **Blend · Hand order** switch; **Shape** chip (Hold / Lift / Ease / Arc, then each flow by name); **Blend by** chip (the existing panel); **Fill from a flow**; **Play**.
  - Energy line: actual energy, the shape dashed, pins as dots.
  - Rows (today's set list *Rows* view): # · sigil · title · `BPM · key` · pin, with a **join line** between rows (diamond, kind, score, problem, **Fix**).
  - After any re-order, **moved rows get a dot** for 4 s and a toast says what happened with **Undo**: `Damage pinned at 4 · 2 tracks moved · Undo`.
- **Right column** follows the selection: a row → its info and **Swap for** (fits between its neighbours); a join → the breakdown, **Put one between**, **Move B to #n**, **Keep, I like it** (today's Fix panel). Nothing selected → today's track info / orbit.
- **Fill from a flow** (D2): popover from the chip: flow (radio, with how many tracks fit), Add 15 min / 30 min / 1 h (`≈ n tracks`), **Use its shape for the whole order** (on by default), Cancel / **Add n tracks**. While open, the new tracks preview as dashed rows and the flow's curve shows on the energy line.
- **Playing** (D3): header `● Playing · order locked`, played rows dimmed, the playing row tinted, Play becomes Pause. An edit re-blends after the playing row; toast `re-blended 5–13 · playing track unchanged · Undo`.
- **Empty playlist**: today's empty editor slots (`EmptyEdit.tsx`, numbered dashed slots).

### 3.2 Phone (P1–P4)

- **P1 Open**: header card (back, name, `Blend · n tracks · length`, ⋯), chips **Shape · Fill · + Add**, energy line, rows with join lines, **Play** sticky above the dock. ⋯ holds Blend / Hand order, Blend by, Re-blend all, Rename, Delete. The list ends above the dock.
- **P2 Tap a row**: bottom sheet `n · Title`, the join from the previous track, four buttons **Play from here · Pin here · Earlier · Remove**, then **Swap for · fits between A and B** (3–5 tracks with score). A swap pins the new track there. **Hold a row** to drag it (the queue's `rowDrag.ts`).
- **P3 Fill**: the same choices as D2 in a sheet; after Add, new rows are marked and Undo shows.
- **P4 Playing**: as D3; Pause sticky.

## 4. Server

### 4.1 Stay-put cost in `order_set`

`order_set(tracks, pins, shape, weights, welcome, stay=False, start=0)` (shipped in PR 1):
- `stay=True`: the order `tracks` come in is the current one (the list as the user left it, a dropped track already at its spot). The engine starts from it and only takes swaps / moves that pay for themselves: a free track at slot *k* costs `STAY · |k − was| / n` extra. `STAY = 1.0`.
- Measured on a clash-heavy 13-track fixture, 48 drops: 37 move nothing, none moves more than 4 rows (fewest-moves count), against 1–8 for a full re-order. Clashes the drops made go from 21 to 12; a full re-order reaches 2, which is what **Re-blend all** is for.
- `start`: the first *start* tracks are fixed (played and playing when locked).
- `stay=False` = today's behaviour (Re-blend all, first switch to Blend).
- `shape` also accepts a curve (energies 0..100 spread over the list), for a flow's shape.
- "Moved rows" for the UI marks = the rows outside the longest common subsequence of the old and new order.

### 4.2 Playlist fields and routes

- Playlist node gains `blend: bool` (default false), `shape: str` (`Hold|Lift|Ease|Arc|flow:<id>`), `pins: {item_id: index}`.
- `POST /music/playlists/{id}/blend` `{weights, welcome, start?, full?}` → re-orders with `prev` = the stored order (unless `full`), saves, returns the node plus `moved: [item_id]`.
- Every existing item route (`add`, `removeItem`, `moveItem`, `reorder`) on a blend playlist pins what the user placed (`add` with an index, `moveItem`) and re-orders in the same call, returning `moved`.
- `POST /music/playlists/{id}/fill` `{flow, minutes, use_shape, weights, welcome}` → picks tracks from the flow's sources (existing flow generator) that fit around the playlist, adds them, re-orders, returns the node plus `added` and `moved`.
- `PATCH /music/playlists/{id}` accepts `blend` and `shape`.
- Parts (a playlist with parts): each part orders on its own (confirmed 2026-11-21).

### 4.3 Migration and removals

- One-time migration: each row of `music_mixes` → a blend playlist named after the mix (rendered tracks, pins → pins, `shape = flow:<flow id>`), in a folder **Mixes** if there are any. The table stays one release, then goes.
- `/music/mixes*` routes and `/music/set/*` routes that only served the set go in the cleanup PR, after their callers are gone. `/music/set/order|fix|spot` logic moves behind the playlist routes (same functions).

## 5. Frontend

- The open playlist replaces `SetLane` / `SetList` in `MusicSurface`; their row, join, Fix, Blend by, selection, drag-box, drag-off-to-remove and Undo code is reused, bound to the playlist (server state) instead of `musicSet.ts`.
- `?pl=<id>` opens a playlist **in the board** (not a separate page). `New playlist` creates one with `blend: true` and opens it there.
- Moved / added marks and the Undo toast come from `moved` / `added` in the responses.
- Lock: `musicQueue` remembers the source playlist of the playing run. While it plays, playlist edits send `start = playing index + 1` and replace the queue after the playing track with the new order.
- Phone: P1–P4 as §3.2; `rowDrag.ts` for hold-to-drag; the swap list uses the fits-between ranking.
- Removed: `MixView.tsx`, `MixesList.tsx`, the Mixes explorer section, `musicSet.ts` and the set lane, `?mx=` and `?tab=mixes` (redirect to the migrated playlist / to the board).

## 6. Build plan (PRs)

1. **Server: stay-put order.** `order_set` `prev` / `start` / curve shape + tests (one pin moves ≤ 3 on the fixture).
2. **Server: blend playlists.** Node fields, `/blend`, blend-aware item routes with `moved`, `/fill`, tests.
3. **Server: migrate mixes** to blend playlists, test on a copy of the live DB.
4. **Board: open playlist in the centre** replacing the set lane (desktop D1): header, energy line, rows + joins, right column follows selection, moved marks + Undo, New playlist opens here, explorer glyphs, Mixes section gone.
5. **Shape and Fill** (D2): Shape chip with flows, Fill popover with preview.
6. **Lock on Play** (D3): queue source, start index, header state.
7. **Phone** (P1–P4): sticky Play, ⋯ menu, row sheet with swap, hold-to-drag, Fill sheet.
8. **Cleanup**: remove mix view, Mixes list, set store and lane, unused `/music/set/*` and `/music/mixes*` routes; redirects; docs.

Each PR: frontend build, tests, phone + desktop check on a preview backend over a copy of the DB.

## 7. Open

- `STAY` value: set in PR 1 from the fixture, then by ear.
