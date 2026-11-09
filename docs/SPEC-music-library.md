# Spec: the Music page as one surface (explorer · tape · set · track info)

> Agreed through interactive mockups, 2026-11-08 → 2026-11-09. The approved mockup is
> [`docs/proto/music/library/play4.html`](proto/music/library/play4.html), served from the repo root
> (`bun /tmp/sestudio-mock/serve.js .` in the mockup sessions; any static server works, the `/api`
> pass-through is only needed for live online search). Its **Tune** panel holds every value the user
> settled on; the table in §2.9 lists them, and they are the defaults to build in. Earlier rounds
> (`a-…` to `n-…`, `play.html` to `play3.html`) are history, not references. Where this text and the
> mockup disagree, this text wins.

## 1. Why

- **Cards.** The Music page is five tabs (Flows · Mixes · Albums · Artists · Tracks) of same-size
  cards and plain rows. Nothing shows what a track or an album *sounds* like.
- **Split up.** Browsing, searching (library and online), building a queue, ordering it and reading
  a track's analysis are five different places. The user wanted one.
- **No order help where it is needed.** Best blend exists for flows and the queue, but a search
  result, an album or a hand-made set cannot be put in its best succession, and the weights behind
  "best" are not the user's to set.

## 2. What was decided

### 2.1 Layout

| Topic | Decision |
|---|---|
| One surface | `#/music` is one page: **explorer** (left, 320px), **centre** (tape, set, track list), **right column** (340px: track info, orbit, Fits after it). The five tabs go. Flows and mixes are reached from the explorer (§2.8). |
| Scrolling | Desktop: the page does not scroll. Each column scrolls on its own, stops above the player bar, `overscroll-behavior: contain`, thin scrollbars. |
| Phone | Columns stack and the page scrolls. The explorer is a full-height panel sliding in from the left (**Browse** chip in a row of quick chips: lists, top artists, sound words). The right column sits under the centre. Mouse gestures (hover card, drag box, HTML5 drag) are mouse-only; touch keeps tap-to-select and the **+** buttons. |
| Header | The app header's search box is the page's one search (§2.3). The `Music` title keeps `N tracks · M libraries`. |
| No cards | Groups are drawn by their tracks' **sigils** (mirrored energy silhouette in the track's colour; a group = its tracks' sigils end to end, width by length). Real artwork is never used here. |

### 2.2 Explorer (left column)

| Topic | Decision |
|---|---|
| Rail | A vertical **icon rail** on the explorer's left edge: Album (default) · Artist · Library · Mood · Genre · Tempo · Energy · Key · A–Z · Flat · **Custom** · (spacer) · **Sort**. A preset sets the grouping levels: Album = `[album]`, Artist = `[artist, album]`, Genre = `[genre, artist]`, Library = the file explorer (below), others one level, Flat = none. |
| Custom | A popover listing every level; clicking stacks them in click order (numbered badges), clicking again removes, "Flat, no levels" clears. Up to 4 levels. The header line reads back the stack ("by mood › artist"). |
| Sort | A popover: groups Natural · A–Z · Most tracks; tracks Natural · Title · BPM · Energy · Length · Bright → dark. Natural = the dimension's own order (mood ladder, tempo bands, energy levels) else count, then title. |
| Sections | **Library** (the tree for the grouping), **Lists** (playlists, smart lists), **Flows**, **Online** (YouTube Music · YouTube · SoundCloud; "type to search" until there is a query). Section headers fold. |
| Node row | Chevron (expands only), icon (album sigil, person, disk, mood dot, genre dot, energy bars, "BPM", key), name, count. Hover shows **+** (adds the whole node to the set, replacing the count). **Click the name = open it on the tape** (source). Double-click a track plays it. Tracks show `title · bpm · m:ss`. Lists show 8 groups then "N more"; Mood, Tempo and Energy always show every group. |
| Library mode | A **file explorer**: library › real folders (nested) › files, folders first, both A–Z. Files show the real file name with a type badge (MP3, M4A, OPUS…), then title when it differs, bpm, length. An **address bar** above the tree: `R: › Musique › Deadmau5 › Vexillology`, each part clickable, **↑** goes up. Shows every file (no de-duplication here). Needs the server change in §3. |
| Search mode | While the search box has words, the explorer goes **flat**: **Online** first (per source, with thumbnails, duration, "video" tag, 5 then "N more"), then **In your library** (matching artists, albums, then tracks with matched words lit; 6 tracks then "N more"), then Lists / Flows that match. Sound words (§2.3) do not go online; only name words do (`onlineSounds` off). |
| Drag | Every node is draggable into the set: a track, an album, an artist, a mood, a tempo band, a list, an online result, a search-result group. A chip follows the pointer (`Vexillology · 10 tracks`). |
| Footer | One line of help ("Click opens it on the tape. Drag a track into your set. Double-click plays.") |

### 2.3 Search

| Topic | Decision |
|---|---|
| One box | Names and sound words together. **Mood words** (Floating, Bright, Warm, Smooth, Dark, Menacing, Unstable, Exotic) and a **tempo** (60–200) become chips inside the box; the rest matches title, album, artist, genre. BPM tolerance **±10**. |
| Scope | The library (tape + explorer) narrows live. Online is asked for the name words only, after a 550ms pause, through `GET /api/music/search?q=&source=all` (exists). Errors per source show under the Online section. |
| Online track in the set | Added with thumbnail and "analysing on add"; its joins are grey until the analysis lands (`edit/onlineAnalysis.ts` already does this for the queue). Its cost in ordering is a fixed middle value until then. |
| Duplicates | A track present in two libraries (same title, duration within 3s) is shown **once** in every grouping but Library mode (32 of 474 tracks today). It plays from whichever library is online. |

### 2.4 Tape (centre, top)

| Topic | Decision |
|---|---|
| Bar | Source chip (`Whole library` / `Album: X ×`), `N tracks · h min`, **Grouped · Best blend** (+ shape Hold · Lift · Ease · Arc when Best blend), a read-back of the grouping and sort, **colour** Mood · Energy · Genre, **Add all to set**, and the selection chip when 2+ tracks are selected ("3 selected · drag them, or Add to set · Clear"). The **Blend by** chip (§2.7) shows when Best blend is on. |
| Legend | Under the bar: mood counts, or the energy gradient, or the top 8 genres, following the colour choice. Colour applies everywhere (tape, explorer sigils, set, orbit, minimap). |
| Minimap | A thin strip of every track in view (height = energy, colour as chosen) with the visible window; click to jump. |
| Tape | Horizontal, mouse-wheel scrolls sideways. Groups follow the explorer grouping: a header per group (level name large and dim, group name, `n · length · bpm range`), a thin divider, then tracks as sigils, **width = duration** at 0.2px/s, **narrowest 32px**, height 95px, label under each (title; `title + mood · bpm` is an option). `gap` between groups 26px. |
| Stretch | When the tracks in view do not fill the width, the zoom is solved (bisection on duration→px) so they fill it exactly, ending at the same 24px margin as the left. Proportions by length are kept. Large sets scroll as usual. |
| Grouped vs Best blend | Grouped = explorer order. Best blend = the set-ordering engine (§2.7) on the tracks in view (cap 160), with a diamond on every join (green ≥ smooth, amber, red rough) and the header `Best blend · Arc · 93 blend · 0 rough joins`. Albums open **Grouped**; a search result, a filter and a playlist open **Grouped** too (playlists keep their own order until asked). |
| Selection | Click selects (and focuses, §2.5). Ctrl/⌘-click toggles, Shift-click selects the range, Ctrl/⌘-A selects what is in view (while the pointer is over the tape), Esc clears. Press-and-drag from empty space or an unselected track draws a **box**; the tape scrolls when the box reaches an edge. Dragging a **selected** track carries the whole selection (HTML5 drag) to the set. |
| Hover card | Mouse only, 180ms, swaps instantly between tracks: title, artist · album · library, energy curve with section labels (intro / buildup / drop / …), chips (mood + mode, key + Camelot, BPM, energy level + value, genre, length), place in the set and both joins, lists it is in, one line of hints. Online tracks: thumbnail + "not analysed yet". |
| Playing | The playing track has a dot above it on the tape; double-click plays a track. |

### 2.5 Right column

| Topic | Decision |
|---|---|
| Track info | Top of the column, for the **selected** track (else the playing one; `×` returns to playing, `^` folds to the title). Title, artist · album, full file path (needs §3), **energy and sections** curve, **spectrum** (bands × time heat strip), six facts (Tempo, Key + Camelot, Mood + mode, Energy level + value with `in a → out b`, Genre, Length), **balance** bars (bass / mids / highs), **harmony** (the 12 notes with the scale lit and the tonic filled; the mode on the brightness ladder Floating … Unstable), place in the set with both joins, lists it is in, **Play** and **Add to / Remove from set**. The data is all in `/tracks/{id}/analysis` today. |
| Orbit | The focused track at the centre; every other track placed by mood (angle, in ladder order) and fit distance (radius: rings "Fits next" 0.22, "Close", "A step away", "Far"); set members outlined. Click a dot to focus it (the tape scrolls to it). |
| Fits after it | The 5 closest tracks to the focused one (fit = tempo 0.25 · mood 0.45 · energy 0.25 of the §2.7 distance, no harmony — unchanged from the mockup), each with **+**. |
| Tune | The mockup's Tune panel is not shipped. Its values become constants (§2.9). |

### 2.6 Your set (centre, under the tape)

The **set** is a working list, separate from the queue. It is where things land when you drag or press **+**.

| Topic | Decision |
|---|---|
| Lane | Title `Your set · n tracks · length · blend`, actions **Play the set · Queue · Save · Clear** (+ **As a flow** on desktop). Controls: **Your order · Best blend** (+ shape), **Blend by** chip, **Pin on drop** toggle, **Unpin all · n** (when pinned), the selection count with Remove · Clear, **Undo remove · n** for 8s after a removal; the score `93 blend · 0 rough · 1 pinned · 2 clashes`. Then the energy line (actual, with the target shape dashed when Best blend) and the tracks as a lane of sigils with a join diamond between each pair. Empty: a dashed drop zone with the instructions. |
| Adding | **+** anywhere, **Add all to set**, drag from the explorer or the tape (single, selection, or a whole group) onto the lane or the track list. A drop **between two tracks** inserts there; with Pin on drop (default on) the inserted tracks are pinned there, else they are blended in. A message shows for 3s where it landed: `Full Bloom → #6 · blends 91 · pinned there`, `Unstable · 14 tracks → #5–18 · pinned there · 3 already in`. Tracks already in the set are skipped. |
| Pins | A pinned track keeps its index; Best blend orders the free tracks around it. Pin / unpin on the item (hover tools), Unpin all in the controls. Pinning while in Best blend first freezes the current order. |
| Reorder | Drag an item (or the whole selection as a block) along the lane; a marker shows the slot. Any hand move switches to **Your order** with a toast saying Best blend puts it back, keeping pins. |
| Remove | Drag an item 36px above or below the lane (50px beside it in a vertical list) → red "Release to remove n tracks" label → release removes; the Delete key removes the selection; `×` on an item. **Undo** restores set, pins and order mode. |
| Save | Opens a small form anchored to the button with a suggested name (`Vexillology mix` inside an album, else `Dark 128 set` from the leading mood and mean BPM), a dup warning, Cancel / Save. Saves a playlist in the current order (`createWithTracks`) and it appears under Lists. |
| Queue | **Add to queue** slots each track where it blends best around what is already queued, never before the playing track. **Play the set** replaces the queue after the playing track with the set in its current order. Both keep the playing track where it is. Undo lasts until the next change. |
| As a flow | Makes a flow from the set's energy shape and plays it (existing flows API; the set's tracks as a Lean source). |

### 2.7 Ordering: Best blend, Blend by, Harmony moves

| Topic | Decision |
|---|---|
| One engine | **Best blend** is the only automatic order. It is weighted by **Blend by** and by **Harmony moves**. There is no separate harmony mode. |
| Join distance | The server's **Blend** (SPEC-blend, `music/blend.py`): one score 0..1 from the layers energy, tempo, harmony, colour (mood) and genre, tuned on the real library. **Blend by** scales the Prefer weight of a layer by `importance / default importance` (harmony → harmony, mood → colour, energy, genre; `blend.layer_weights`), so the defaults reproduce today's score exactly. **Tempo keeps its own weight** (the guard) and is not an axis. The harmony part is the **welcome** of the join's move (below), replacing `HARMONY_PART`. Distance `d = 1 − blend`. A join is **smooth** at blend ≥ 0.83, **rough** below 0.58, **close** between (`proximity.mark`). *(The mockup's own formula in `order.js` was a stand-in; the user's numbers 0.17 / 0.42 are these thresholds as distances.)* |
| Kinds | `proximity.join` as today: **same-key**, **pivot** (same notes, other tonic), **next-door** (6 shared, other tonic), **modal-shift** (6 shared, same tonic), **transposed** (same mode, tonic moved; split into **lift** up / **drop** down by `semitones`, `proximity.move_of`), **clash** (otherwise). Lift and drop are **not** clashes (SPEC-key-transposition). Welcome defaults reproduce `HARMONY_PART`: same-key 1 · pivot .8 · next-door .6 · modal-shift .6 · lift .5 · drop .5 · clash 0. |
| Blend by | Importances per axis, 0.02…1; defaults harmony .9 · mood .45 · energy .7 · genre .35 ("Harmony first"). Shown on a **radar** (one dot per axis, drag out = more), the four percentages, help line, 10 presets: Balanced, Keys first, Keys only, DJ classic, Energy flow, Energy only, Mood first, Radio, Stay in genre, Cross genres (values in `weights.js`). The active preset is highlighted; anything else reads "Custom". A live effect line: `Your set: 54 blend · 5 clashes · 2 lift/drop · 3 genre changes`. "Tempo is kept close on its own." |
| Harmony moves | A nested accordion inside Blend by, header `Harmony moves · <preset>`. A slider 0–100 per move (Same key, Same notes, Next door, One note changes, Lift, Drop, Clash: the app's `KINDS` labels) = how welcome it is; defaults are the server's (100 · 80 · 60 · 60 · 50 · 50 · 0), so "Default" is today's behaviour. Each row has a two-scale picture and the count of such joins in the set. 9 presets: Default, Same key only, Strict keys, Circle of fifths, Modal, DJ friendly, Lift the set, Bring it down, Anything goes (values to be set in PR 9 on these scales). |
| Placement | A **sticky bar** pinned to the top of the centre column whenever Best blend is on (set or tape): `▮▮ Blend by · Harmony first · Harmony: Default · set 54 blend · 5 clashes ⌄`. Clicking it opens the panel **downward from the bar, over the column**, so the set stays where it was; Done / Esc / the bar closes it. The bar's summary updates live. (The "under the row" and "top of column" placements were tried and dropped.) |
| Persistence | Weights live on the device (`localStorage`) and are sent with every order / fits / bridge request. Changing them re-orders the set live (on release for drags). |
| Algorithm | `builder.order_set` (PR 1). Greedy: the opener is the free track nearest the shape's start energy (or the pinned one), then each free slot takes the free track with the lowest `d + 0.8 · |energy − wanted| / 60` (wanted energy from the shape Hold / Lift / Ease / Arc across the set's energy range); pinned tracks stay at their index. Then up to 6 passes of 2-opt reversals of free runs that cut the outer joins plus the run's shape distance (a clash weighs +3 there). Cap 200 tracks (above that: greedy only). Runs on the server; the frontend only draws. |

### 2.8 Tracks in your set, problems, fixes

| Topic | Decision |
|---|---|
| List | Under the lane: `Tracks in your set · n · length` with **Rows · Table · Joins**. **Rows** (default): per track grip · # · sigil · title with `mood · key Camelot · bpm · artist` · energy bar · length · pin · ×, and a **join line** between rows (score diamond, kind label, tempo, Lift/Hold/Ease, genre change; coloured with a Fix button when there is a problem). **Table**: dense columns #, Title, Key, Mood, BPM, Time, Next join (diamond + score + a dot per problem + Fix), pin, ×; header click sorts the set by that column (switches to Your order). **Joins**: one row per transition `1→2 · A → B` with both tracks, the score and every chip. Same selection, drag-reorder, remove and drop behaviour as the lane. |
| Problems | **Clash** (kind clash), **tempo jump** (`tempoJump` from `proximity.join`, i.e. beyond the tempo tolerance and not across a genre change), **energy jump** (|outro − intro| > 25). Counted in a bar on top (`5 clashes · 2 tempo jumps · 2 energy jumps`), with a **rail** of diamonds placed by position (click = jump and open), **Only problems**, **Fix all**. |
| Fix panel | Opens in place under the join: "Clash between A and B", then **Put one of these between**: the 3 best library tracks not in the set, each `sigil · title · mood · bpm · shares x and y notes` and a verdict **fixes it** / **softer · n left**, with **Insert**; then **Move B to a better spot** (the slot with the fewest problems, then smoothest) and **Keep, I like it** (the join stops counting; `Kept · undo`). Every fix freezes to Your order so it stays put. Bridges come from `POST /music/proximity/bridges` with the weights. |
| Fix all | Repeat: for each problem join in order, insert the best bridge if it leaves no problem, else move the second track to its best spot if that lowers the problem count; stop when nothing improves. Report `Added 2 bridges, moved 1 track. 3 left: Keep them or fix by hand`. |

### 2.9 The values settled in the mockup (build these in as constants)

| Value | Default |
|---|---|
| Explorer width · right column width | 320px · 340px |
| Tape zoom · narrowest track · track height · group gap | 0.2 px/s · 32px · 95px · 26px |
| Tape labels · colour · headers · stretch · minimap | title · mood · on · on · on |
| Explorer: rail · groups before "more" · flat search · online first · online per source · BPM in rows | icon rail · 8 · on · on · 5 · on |
| Search: sound words · BPM tolerance · sound words online · de-duplicate | on · ±10 · off · on |
| Orbit fit weights tempo / mood / energy · fits ring · rows | .25 / .45 / .25 · 0.22 · 5 |
| Blend: tempo guard · smooth below · rough from · shape pull · default order · default shape | .3 · .17 · .42 · .8 · Best blend · Arc |
| Blend by importances h / m / e / g | .9 / .45 / .7 / .35 |
| Harmony welcome same / relative / next / mode / lift / drop / clash | 1 / .9 / .85 / .55 / .45 / .35 / 0 |
| Pin on drop · landing message · hover card delay · track list style · Blend by placement | on · on · 180ms · Rows · sticky bar |

### 2.10 Decided by default (the user did not object; change here if wrong)

- Albums open in their own order; search results and filters open Grouped; playlists keep their
  order. Best blend is one click away in every case.
- Applying an order to the queue never moves the playing track; Undo lasts until the next change.
- Ordering never adds a track by itself; only **Insert** in a Fix panel and **Fix all** do.
- A track in two libraries shows once outside Library mode and plays from an online library.
- The tape and the orbit are static drawings (SVG), redrawn on change, not per frame; no WebGL
  (CLAUDE.md's WebGL rule is for per-frame animation). The one animation is the accordion.
- The library recap the user asked for at the very start is **not** in this spec beyond the legend
  counts and the `N tracks · libraries` line; a recap strip is a later, separate round.

### 2.11 Out of scope

Redesigning the flows editor, the mixes view, the player, casting; pitch-shifting; artwork;
touch drag-and-drop; a details/columns view of the file explorer (sizes, dates).

## 3. Building blocks that already exist (reuse them) and server gaps

- **Tracks:** `GET /api/music/libraries/tracks` (id, library, library_label, title, artist, album,
  duration, folder, name). **Gap:** `name` is the folder's display name, not the file. Add `path`
  (the file's path inside its library, posix) so the file explorer and the info panel can show
  real file names. `downloaded.DownloadedFile.path` already holds it; `libraries.local_tracks()`
  just does not pass it on.
- **Summaries and analysis:** `GET /tracks/summary?ids=` (bpm, key, camelot, genre, harmony.track
  {tonic, mode, notes, brightness}, energyLevel, energyScale {track, intro, outro}, balance) and
  `GET /tracks/{id}/analysis` (bands, energy, structure, loudness, hue). The info panel, the hover
  card and the sigils need nothing more.
- **Joins and kinds:** `proximity.harmony()`, `transposition()`, `join()` (shared, kind, safe,
  energy step, genreChange, bpmDelta, tempoJump), `cost()`, `fits_after()`, and the routes
  `/music/proximity/join`, `/fits-after`, `/bridges`, `/bridge-path`. **Gap:** `cost()` is fixed
  (notes ×3 + tempo + energy). It must take the §2.7 weights (axis shares + per-kind welcome) and
  the tempo guard. Keep its current numbers as the "Default" preset's behaviour.
- **Building a set:** `builder.build_arc(pool, arc, length, seed, start, skip)` and
  `POST /music/set/build`, `GET /music/set/presets`. **Gap:** ordering a *given* list with pins
  and a shape. Add `POST /music/set/order` `{ids, pins: {index: id}, shape, weights, harmony}` →
  `{order, joins: [{kind, shared, d, problems}]}` and `POST /music/set/fix` `{ids, kept, weights,
  harmony}` → `{order, inserted, moved, left}`. Both reuse `join()`/`cost()` so Python stays the
  single truth; the frontend never re-implements the score (the mockup's `order.js` is a stand-in).
- **Search:** `GET /api/music/search?q=&source=` (`music/search.py`: library + ytmusic + youtube +
  soundcloud, 15s timeout, cached). As is.
- **Online tracks:** `edit/onlineAnalysis.ts` analyses on add; `musicQueue.ts` `addPayload` /
  `resolveLink`. As is.
- **Playlists:** `createWithTracks`, `playlistApi`, `/{node_id}/items`, `/items/move`,
  `/items/reorder` in `musicPlaylists.ts`. As is.
- **Queue:** `musicQueue.ts` (`addToQueue`, `post`), `Queue.tsx`, `QueueGap.tsx` (gap marks, open
  gap with bridges), `FitsGap.tsx`, `RowThread.tsx`. Reuse the gap mark and the bridge list for the
  Fix panel; the set's "Add to queue" uses the fits-between placement already in `QueueGap`.
- **Flows and mixes:** `FlowsHome.tsx`, `FlowRow.tsx`, `FromBar.tsx`, `PlayAsFlow.tsx`,
  `MixesList.tsx`, `MixView.tsx`, `/flows/*`, `/mixes/*`. Shown in the centre column when picked in
  the explorer (replacing the tape area); not redesigned.
- **Harmony words and colours:** `harmony.ts` (`MOOD_LADDER`, `EXOTIC`, `keyDisplay`), `musicTheory.ts`.
- **Mockup code to port, not copy:** `docs/proto/music/library/` — `group.js` (groupings, tree,
  tape groups), `explorer.js` (tree walk, flat search, address bar), `select.js` (marquee, modifiers),
  `drawer.js` (lane, pins, block moves, remove gesture, landing message, `askName`), `setlist.js`
  (rows/table/joins, problems, fix panel), `weights.js` (radar, presets, accordion, sticky bar),
  `hover.js`, `info.js`, `common.js` (`silhouette`, `sigil`, `ribbon`, `trackColor`). The sigil
  drawing (`silhouette`) is the one thing to lift as is.

## 4. Traps (read before touching anything)

- **The set is not the queue.** The set is a working list in the page's store; the queue is the
  server's. "Play the set" and "Add to queue" copy from one to the other. Do not make the lane edit
  the queue directly, or every drag becomes a server round-trip and Undo breaks.
- **Scores live on the server.** The mockup scored in JS (`order.js`). The real page asks
  `/music/set/order` and `/proximity/*`, and debounces: re-order on drag **release**, not on move.
  Draw the previous order while waiting; never block the pointer.
- **Two tracks can be one song.** 32 of 474 library tracks are the same file in two libraries with
  two ids. De-duplicate by (title, duration ± 3s) for display, keep both ids, and when adding to the
  set or queue use the id whose library is online. Library mode shows both.
- **`name` is not the file name.** See §3. Until the server ships `path`, the file explorer cannot
  be built; PR 1 goes first.
- **Lift/drop are not clashes.** `proximity._kind` already returns `transposed`; the set list's
  problem rule must use the kind, not `shared <= 5`.
- **Pins and Best blend.** Pinned tracks keep their *index*; the free tracks are reordered into
  the free slots. Dropping on a slot with Pin on drop pins *all* dropped tracks there as a block.
- **Hand moves switch the mode.** Any drag-reorder, header sort, Insert, Move or Keep switches the
  set to Your order (with the toast), otherwise Best blend would undo the user's move on the next
  render.
- **One accordion, re-mounted.** The Blend by panel is one element that survives re-renders
  (moved back under the sticky bar after each render), or dragging the radar loses pointer capture.
- **Global names clashed twice in the mockup** (`changed`, `mood`). In React this is moot, but keep
  the new code in its own folder (`components/music/library/`) and its own stores.
- **Selection boxes vs drags.** On the tape, a press on a *selected* track starts an HTML5 drag; on
  an unselected track or empty space it starts a box. Mixing both on one element needs the
  pointer-down to decide first, and `draggable` only on selected tracks.
- **Hover card is mouse-only.** Gate it on `pointerType === 'mouse'`; on touch the tap selects.
- **442 DOM nodes on the tape are fine; 442 × hover listeners are not.** One listener on the tape,
  delegated. Re-render the tape only when source, grouping, colour, zoom, selection or playing track
  change; the minimap and legend separately.
- **Stretch must end exactly at the margin.** Solve the zoom before drawing (bisection on the
  summed `max(minW, d·k)`), then set the inner width to the visible width; iterating redraws
  overshoots.
- **The sticky bar covers the top of the column when open.** The panel scrolls inside itself
  (`max-height: calc(100vh − 260px)`); keep Done visible.
- **Old URLs.** `#/music?tab=albums|artists|tracks|flows|mixes`, `?al=`, `?ar=`, `?lib=`, `?genre=`
  are linked from Home widgets and the player. Map them: `tab=flows|mixes` → the explorer section
  opened in the centre; `al`/`ar`/`lib` → source; `genre` → a Genre grouping with that group as
  source; everything else → the whole library.

## 5. Build plan (PRs)

Files: new `frontend/src/components/music/library/` (`MusicSurface.tsx`, `Explorer.tsx`,
`ExplorerTree.tsx`, `Rail.tsx`, `AddressBar.tsx`, `grouping.ts`, `Tape.tsx`, `tapeLayout.ts`,
`TapeBar.tsx`, `Legend.tsx`, `Minimap.tsx`, `sigil.ts`, `HoverCard.tsx`, `TrackInfo.tsx`,
`Orbit.tsx`, `FitsAfter.tsx`, `SetLane.tsx`, `SetList.tsx`, `FixPanel.tsx`, `BlendBy.tsx`,
`HarmonyMoves.tsx`, `selection.ts`, `dragDrop.ts`), stores `frontend/src/musicSet.ts`,
`musicBlendWeights.ts`, `musicGrouping.ts`; `views/MusicView.tsx` becomes the surface;
server `src/sestudio/music/libraries.py`, `proximity.py`, `builder.py`,
`web/routes/music.py`, `web/routes/music_libraries.py`.

### PR 1: Server: file paths and weighted joins
- `/libraries/tracks` items get `path` (posix, inside the library). Test on a nested folder.
- `proximity.cost(j, weights=None, welcome=None)`: §2.7 formula; `None` = today's numbers. `join()`
  gains `kind` for lift/drop as today's `transposed` plus `semitones`. `fits_after`, `/fits-after`,
  `/bridges`, `/bridge-path` accept `weights` and `harmony` (welcome) in the body.
- `POST /music/set/order` and `POST /music/set/fix` (§3), on `builder.py` + `proximity.py`.
- Tests: weights change the order the way the mockup measured (queue of 46: harmony-first leaves
  fewer clashes than genre-first), pins keep their index, Default weights reproduce today's
  `cost()` ranking, fix inserts only bridges that leave no problem.

### PR 2: Shell, explorer browsing
- `MusicView.tsx` → `MusicSurface`: three independently scrolling columns (desktop), stacked on a
  phone with the explorer as a slide-in panel. The tabs go; old URLs map as in §4.
- Explorer: rail, presets, Custom stack, Sort, sections Library / Lists / Flows, the tree with
  `+` and click-to-open, counts, "N more". `grouping.ts` with tests (tree for each preset and a
  2-level stack; natural orders). Library mode = file explorer with the address bar (uses PR 1).
- The centre shows a plain grouped track list for now (the tape comes in PR 3) so the page works
  end to end.

### PR 3: Tape
- `Tape.tsx` + `tapeLayout.ts` (grouped layout, stretch solver with tests, minimap), `TapeBar.tsx`
  (source chip, counts, Grouped / Best blend + shape, grouping read-back, colour, Add all),
  `Legend.tsx`, `sigil.ts` (port `silhouette` / `sigil` / `ribbon` / `trackColor`). Best blend on
  the tape calls `/music/set/order`. Click selects and focuses; double-click plays; wheel scrolls
  sideways; playing dot.

### PR 4: Right column
- `TrackInfo.tsx` (every row of §2.5, fold / back-to-playing), `Orbit.tsx` (placement, rings,
  click-to-focus, set outline), `FitsAfter.tsx` (5 rows, `+`). `HoverCard.tsx` on tape, explorer,
  set and fits rows (mouse only).

### PR 5: Search
- Sound-word parsing into chips (moods, BPM ±10), live narrowing of tape and explorer, the
  explorer's flat mode (Online first, then library, then lists) with debounced online search and
  per-source errors, online results as draggable nodes, "analysing on add" items in the set.

### PR 6: The set: store and lane
- `musicSet.ts` (tracks, pins, order mode, shape, undo), `SetLane.tsx` (§2.6 controls, energy line,
  lane of sigils with join diamonds, empty drop zone), `dragDrop.ts` (drops from explorer and tape:
  track, group, selection; slot insertion; Pin on drop; landing message), pin / unpin / Unpin all,
  Save with the name form, Play the set, Add to queue (slotting), Clear, As a flow.

### PR 7: Selection and gestures
- `selection.ts`: tape and lane selection (click, Ctrl/⌘, Shift, box with edge-scroll, Ctrl/⌘-A,
  Esc), selection chip in the tape bar, dragging a selected tape track carries the selection,
  block reorder in the lane, drag-off-to-remove with the red label, Delete key, Undo (8s).

### PR 8: Tracks in your set
- `SetList.tsx` with Rows / Table / Joins, the problems bar with rail, Only problems, `FixPanel.tsx`
  (bridges from `/proximity/bridges`, Move to a better spot, Keep with undo), Fix all via
  `/music/set/fix`, header sort in Table, the same drop / selection / reorder behaviour as the lane.

### PR 9: Blend by
- `musicBlendWeights.ts` (importances, welcomes, presets, localStorage), `BlendBy.tsx` (sticky bar
  with live summary, accordion opening downward, radar with drag, percentages, 10 presets, effect
  line), `HarmonyMoves.tsx` (nested accordion, 7 sliders with pictures and counts, 9 presets).
  Weights ride along on every order / fits / bridge request; re-order on release.

### PR 10: Flows and mixes in the surface, phone pass, cleanup
- Flows and Mixes sections open `FlowsHome` / `MixView` in the centre; `PlayAsFlow` and the From
  bar reachable from explorer nodes (the §2.2 doors replace #535's). Phone: Browse chip + panel,
  quick chips, stacked columns, set actions compact, Blend by panel as a bottom sheet. Remove the
  old `AlbumCard` / `TrackRow` / `Detail` code paths, the `Explore` tab remnants and the
  `?tab=` handling that is no longer reached. (The mockup's screenshots in
  `docs/proto/music/library/shots/` are not committed; the HTML, JS, CSS and `data.js` are.)

## 6. Checks for every PR

- `uv run pytest` for server PRs; `npm run build` and `npm test` in `frontend/` for frontend PRs,
  rebuilt right away (CLAUDE.md).
- Look at it at 390px and 1440px: the whole library, a 3-track album (stretch), a search with
  online results, a set of 10 with at least one clash, Blend by open with Harmony moves open.
- Drag: a track, an album and a 3-track selection into the set at a slot; reorder a block; drag a
  track off to remove and Undo; Pin on drop off and on.
- Order: switch Best blend ↔ Your order, change a Blend by preset and watch the set re-order
  only on release; Keys first must leave fewer clashes than Stay in genre on the Queue.
- Keyboard: tree, rail, tape tracks, set items, the accordion and the name form reachable with Tab;
  Esc closes; focus returns to the opener.
- Perf: the whole library (474) on the tape scrolls at 60fps on the user's desktop; a Blend by
  change on a 46-track set re-orders in under 300ms end to end.

## 7. Sizes

| PR | Size |
|---|---|
| 1 | M (server: paths, weighted cost, order + fix endpoints, tests) |
| 2 | L (shell + explorer + grouping + file explorer) |
| 3 | M |
| 4 | M |
| 5 | S |
| 6 | M |
| 7 | M |
| 8 | M |
| 9 | M |
| 10 | M |
