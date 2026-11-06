# Flows: the spirit of music in sestudio

Status: spirit document, v0 (2026-11-06). No code. Mockups (phone and desktop) come next, then a PR plan.

## 1. The idea in one paragraph

You do not pick songs. You pick how the next hour should feel and move, and sestudio finds the songs. The thing you pick, build and share is a **flow**: a score of layers (tempo, energy, harmonic motion, mood, genre) drawn over time, that can fork into several futures. Playing a flow renders a **mix**: one path through the flow, filled with real tracks. A mix always remembers the flow and the path it came from, so you can edit it as a list or as a flow, and a hand-made list can be turned back into a flow.

## 2. Vocabulary

| Word | Meaning | Replaces |
|---|---|---|
| **Flow** | A generator: layers over time, with branches. The master object. | smart list, set builder, "Order what's next" |
| **Layer** | One dimension of a flow over time: tempo, energy, harmony, mood, genre. | "aspect" |
| **Block** | One stretch of a layer with a target. Named layers (harmony, mood, genre) are sequences of blocks. | — |
| **Curve** | A numeric layer (tempo, energy): a line with a tolerance band. | — |
| **Chunk** | A slice of a whole flow (all its layers) between two points in time. What you drag, insert, copy. | — |
| **Branch** | A point where a flow splits into two or more futures. Each future is a chunk that may branch again. | — |
| **Path** | One route through the branches, start to end. | — |
| **Mix** | A flow + a path + a length, rendered into tracks. The only list object. | playlist, queue, set |
| **Pin** | A track you placed by hand at a point of a mix. Regeneration keeps pins and refills around them. | — |
| **Frozen mix** | A mix snapshotted into a fixed track list. The flow can change; the frozen mix does not. | saved playlist |
| **Preset** | A saved flow, chunk or layer, reusable by drag and drop. | — |
| **The queue** | The mix that is playing. Not a separate object. | queue |

Interface copy stays in English; these words are the copy.

## 3. Time

- A flow is **proportional**: its axis is 0 → 100 %. The length is a setting on the flow (a chip on its card: 30 min, 1 h, 2 h, endless); **Play just plays**. Default is endless: a flow without a loop branch repeats its last chunk as a loop. Blocks and chunks are fractions, shown to the user as the time they would take at the chosen length.
- **Endless** is not a second kind of flow. A flow is endless when a branch leads back to an earlier point (a loop). A flow that ends with a loop plays forever; the loop's branches decide what the next cycle does.
- A chunk inserted in the middle takes the share it had in its source flow; the rest is rescaled. The user can then stretch it.

## 4. Layers

Two shapes, one per kind of data.

### 4.1 Curves (numbers): tempo, energy

- A line over time with a tolerance band (tempo ±3 BPM by default, energy ±1 of 5 steps).
- Drawn by dragging points; a straight segment is a glide, a step is a jump.
- Absent layer = no constraint.
- Data today: tempo (profile v2, no half-time handling), energy per bar (70 % loudness + 30 % high share), both already on every analysed local track.

### 4.2 Blocks (names): harmony, mood, genre

Each block is a stretch with a target and a strictness (must / prefer).

**Harmony** is about one thing: the compatibility of two consecutive tracks, on the app's reading of every track as a scale (tonic + mode, a set of 7 notes), not on Camelot. A join is one of three things: a **match**, a **modulation**, or a **break**. The layer is not blocks to fill: **every join is a match unless an event is placed**. The tone is implicit: the first track sets it, matches carry it, each modulation moves it by a known amount.

| Join | What the pair shows | Feel |
|---|---|---|
| Match | same key, or the relative (all 7 notes shared) | seamless |
| Up a fifth | one note swapped sharpward, new tonic (to the dominant side) | brighter, lifting |
| Down a fifth | one note swapped flatward, new tonic (to the subdominant side) | darker, settling |
| Brighter mode | same tonic, one note sharpward (Aeolian → Dorian) | colour change, same ground |
| Darker mode | same tonic, one note flatward (Aeolian → Phrygian) | colour change, same ground |
| Relative | same notes, new tonic (minor ↔ major) | a modulation you barely hear, placed on purpose |
| Break | fewer than 6 shared notes | a reset |

An **event** is a point on the chunk's timeline with one of the six kinds above (the five modulations and Break). It is realised at the first join after it; when no track can realise it there, it slides to the next join and shows as pending; at the chunk's end it is dropped and shown as missed. A chunk reads like a sentence: *mostly match, one Up a fifth at 60 %, a Break at the start of the come-down*. "Lift every track" is an event on every join: the lane shows the absurdity.

**Harmony is a pull, not a gate.** It never excludes a track: every candidate gets a fit from 0 to 1 for the join wanted (the exact join 1, the relative for a match .8, a safe modulation nobody asked for .6, a plain match while an event is pending .5, a break not asked for 0, an unread key .4), weighted by the flow's **pull** (light ×1, strong ×2 by default, only ×6) against tempo and energy closeness (×1 each). So the mix never leaves the tempo or energy curve to find a key, but among everything in range it takes the harmonic neighbour first, and events are reached for when a track in range can serve them. Harmony has no relaxation step; the fit is shown on every join instead. The same fit and pull rank **suggestions** (Fits next, the add panel): a list ordered by the combined score, each row saying why in one word (Match · Up a fifth · Break), the pending event named at the top as what the flow is looking for.

A chunk with no harmony layer is free. A track whose mode is unsure keeps its tonic and shows "?".

**Mood** is analysed per track on three axes: dark ↔ bright, calm ↔ aggressive, sad ↔ happy. A mood block names a region of that space ("dark and aggressive"); named moods are presets over the axes, so the user can define their own. Where the scores come from (Essentia's CC BY-NC-SA mood models, the key's mode and brightness, or a mix of both) is decided by a research note on the test tracks first (§11). If models are used they are optional like the genre model: stated in Settings, the mood layer is absent without them.

**Genre** reuses today's genre with confidence and the user's override. A block lists one or more genres.

## 5. Branching

A branch is a fork in all layers at once (a chunk ends, two or more chunks begin). The one who takes the branch is any of:

1. **The listener, while listening.** A fork ahead appears on the timeline before the branch point (about two tracks ahead); tapping a future selects it. Silence = default future.
2. **The generator.** When no one chooses, it takes the future the library can satisfy best, and says so ("took *Deeper* — *Lift* had nothing in key").
3. **A condition on the branch.** v1 ships three: **skips** ("2 of the last 4 skipped"), **session length** ("after 60 min"), **time of day** ("after 23:00"). A branch has at most one condition; with none, rules 1 and 2 apply.
4. **Up front.** Choosing a path before playing; the whole tree stays visible and switchable.

The **multiverse view** is the flow drawn with all its branches; the mix is one path lit through it. A playing mix shows the lit path and the futures it has not taken; the past is fixed, the future can still re-route.

## 6. Generation

Given a flow, a path, a length and the library:

1. Slice the path into slots (one per expected track, from length and the tempo-typical track duration).
2. For each slot, score every candidate on every present layer; a candidate must satisfy *must* blocks and the curves' bands, and is ranked by *prefer* blocks, closeness to the curve's centre, and no repeats.
3. Choose with a seed (so "same again" is possible) and a little randomness (so "again" gives a cousin).
4. When nothing satisfies a slot, **relax and show it**. First one layer alone, in this order: tempo (±8 instead of ±3), energy (two steps), mood, genre (harmony is never relaxed: it is a weight, §4.2). Then the same order cumulatively. Last, every curve becomes a preference, so a mix never stops short of its length. The stretch shows exactly the relaxation it needed ("harmony: loose" rather than every layer at once); the user can accept, pin a track, or widen the flow.
5. Pins are fixed before scoring; slots around a pin score against it.
6. Transitions between chosen tracks use the existing mix plan (beat-synced out of an outro into an intro, never over a drop).

Source: the local library. A flow carries an **Allow online** switch, off by default; when on, a slot that no local relaxation can satisfy may be filled from SoundCloud/YouTube by genre and tempo, analysed on add as today, and shown as online in the mix. Online tracks can always be added by hand.

## 7. Mixes

- A mix is **live** by default: it is the flow, path, length, seed and pins. It re-renders when the flow changes and when the library grows. Playing it tomorrow may give cousins of today's tracks.
- **Freeze** turns it into a fixed track list. It keeps its lineage (flow, path, pins) read-only, so it can be **thawed** into a live mix again, or used as the seed for a new flow.
- Track-level edits (reorder, swap, delete, insert) on a live mix become **pins**; the link to the flow never breaks.
- Flow-level edits on a mix change the **shared flow** for every live mix that uses it. Frozen mixes are untouched. This is the freeze contract: unfrozen follows the flow, frozen does not.
- A mix from nowhere (a hand list, an imported playlist, today's playlists) can be **read as a flow**: its layers are inferred from its tracks (tempo and energy curves through the actual values, harmony movements between neighbours, mood and genre blocks from runs of similar tracks). The inferred flow is a normal flow; the mix becomes a live mix on it with every track pinned. Unpinning tracks is how the user lets the generator take over.

## 8. Composition

- The flow editor is a timeline with one lane per layer; the multiverse view adds branches as parallel lanes that split off.
- Building is **drag and drop**: a preset flow, chunk or layer dropped onto the timeline; dropped between two points it inserts, dropped on a layer lane it replaces that stretch of that layer only.
- **Branching** is one gesture: drag a chunk onto the timeline while holding, or press "Branch here" at a point, which duplicates the remaining path into a second future to edit.
- Presets ship as a small starter library (names are illustrative): *Warm-up* (tempo and energy rise, matches only), *Peak* (high energy, one Up a fifth halfway), *Come-down* (energy falls, a Break at its start, then the Relative), *Deep* (dark mood, a Darker mode halfway), plus layer presets (*Climb*, *Plateau*, *Wave* for curves; *One lift*, *Lift then home*, *Colour change*, *Reset* for harmony).
- Everything a user builds can be saved as a preset at any grain (whole flow, chunk, single layer).

## 9. Entry experience

The Music tab opens on:

1. **The dial** on top: one question, "how should it feel now", as a few controls (energy, mood, tempo; genre optional). It generates a flow on the spot and plays it. For the no-decision evening.
2. **Flows below**: recent, then presets, as cards that play on one tap and open the editor on a second gesture.
3. Library, mixes and tracks behind these, as today's content area.

A playing mix is the queue. The player shows the lit path through the flow, the fork ahead when one is near, and the relaxations where they happened. Phone and desktop both get these views; mockups are the next step.

## 10. Migration

- Existing playlists become **live mixes with every track pinned**: each is read as a flow at migration (§7), so unpinning a track lets the generator in at once. Nothing plays differently until a pin is removed.
- Smart lists become one-layer flows.
- The set builder, Fits next and "Order what's next" are removed in the PR that ships the flow editor.
- The queue page becomes the playing mix's view.

## 11. Open decision and next step

1. **Mood source** (§4.2): a research note benchmarks, on the 46 test tracks against the user's own judgement, Essentia's mood models (aggressive, happy, sad, relaxed, party) versus key mode + brightness for dark ↔ bright, then picks per axis.
2. **Prototype: the flow lab** (`docs/proto/flows/`, 2026-11-06). A page that edits a flow (curves, centre, progression, genre, forks, presets by drag and drop, pins, freeze) and plays the rendered mix with real audio; `flowgen.js` is the generator with a self-check. Judged by ear next; mockups (phone and desktop) and the PR plan follow it. The harmony model above is the third: movement words per join made every join a lift with no home; centre + progression blocks held the tone but asked the user to author a home scale and degrees; match-by-default with placed, characterised modulations keeps only the pair compatibility and was chosen as the one to root the tool in.

## 12. UI board and PR plan

**Board** (2026-11-06, approved globally): `.impeccable/mocks/flows/board.html`, five surfaces, each desktop and phone on the app's chrome: (1) entry with the dial and flow cards, (2) the playing mix with the path strip and the fork ahead, (3) the editor, full on the phone with stacked lanes and long-press grab, (4) the mix as a list with lineage, pins and freeze, (5) suggestions ranked by the pull with one word of why. Decisions still open on the board: the dial's wording and shape ("How should it feel now" is a placeholder the user will redo), the fork-ahead shape, lane order and heights, the pin look, how much "why" per suggestion row.

**Plan.** Each PR is shippable on its own; the flows tab stays behind the existing `lab` flag until PR 11 removes the old objects.

| # | PR | Deps | Size |
|---|---|---|---|
| 0 | **Board in the repo** (this PR): the board and this plan. | — | S |
| 1 | **Data model and API.** A `flow` document (chunks with `share`, `next`, `layers`: tempo and energy curves, harmony events, genre blocks; `pull`, `length`, `allowOnline`) and a `mix` document (flow id, path choices, length, seed, pins, `frozen` track list or null) in `library.db`; CRUD under `/api/music/flows` and `/api/music/mixes`; presets as flows with `preset: true` seeded on first run (§8). Tests: round trips, a frozen mix ignores a flow change. | — | M |
| 2 | **Generator on the server.** `music/flows.py`: `join()` (the seven kinds from note sets, §4.2), `fit()` and the pull, the relaxation ladder (one layer alone, then cumulative, then `any`), events realised at the first join after them and sliding on, pins, the seed deciding only between near-ties, `resolve()` taking the fillable future at an unchosen fork. `POST /api/music/flows/{id}/render` and `/mixes/{id}/render`. Ported from `docs/proto/flows/flowgen.js` with the same self-checks as tests, plus the relaxation labels on the 46 test tracks. | 1 | M |
| 3 | **Queue = the playing mix.** The queue document carries the mix it plays; playing a mix fills it; the played part is fixed and the future re-renders when the flow, the pull or a pin changes; a `mix` field in the queue state and SSE. "Read as a flow": a hand list becomes a live mix with every track pinned and a flow inferred from its tracks (§7). | 2 | M |
| 4 | **Music tab entry** (board 1). Flows / Mixes / Library tabs; flow cards (name, energy shape, events as dots, futures, length chip, one-tap play); the dial as three sliders generating a one-chunk flow (placeholder design, to be redone); New flow. Albums / Artists / Tracks behind Library. | 3 | M |
| 5 | **Player: the path** (board 2). Path strip above the timeline (chunks, the lit one, untaken futures dashed); the fork ahead within two tracks as a choice on the strip and on the queue, silence = the generator's pick; queue rows with the join word, its fit and relaxation chips; the "looking for" event on the timeline; "This flow" side panel with Edit flow and Freeze. | 3 | M |
| 6 | **Editor, desktop** (board 3). The lab as a React view: multiverse strip with Branch here, presets rail with drag and drop of chunks and layers, lanes (tempo, energy curves with points; harmony events; genre blocks), chunk resize, forks, the rendered mix under the lanes, Save as preset, length and pull. SVG, not WebGL: nothing is redrawn per frame. | 2 | L |
| 7 | **Editor, phone** (board 3). One chunk at a time, lanes stacked, the strip to move between chunks, long press to grab a point or an event, presets as a horizontal rail, the chunk's mix below. | 6 | M |
| 8 | **Mix as a list** (board 4). Lineage header (from flow › chunk, live or frozen), Freeze / thaw as one toggle, Regenerate, drag to reorder = pin, Unpin, row menu (Pin, Swap, Fits next, Move), "Read as a flow" on lists with no flow. | 3 | M |
| 9 | **Suggestions** (board 5). Fits next and the add panel ranked by the combined score with the pull; "looking for" named at the top; one join word and fit per row, other layers' cost when it matters; "place an event instead" chips. Replaces the Fits next filters. | 2, 5 | M |
| 10 | **Branch conditions and online fill.** Skips, session length, time of day on a branch (§5); the `Allow online` switch filling a slot from SoundCloud/YouTube after every local relaxation fails, analysed on add (§6). | 3 | M |
| 11 | **Migration and removal.** Playlists → live mixes with every track pinned; smart lists → one-layer flows; set builder, Order what's next, the old Fits next entry points and the queue page removed; the `lab` flag dropped. | 4–9 | M |
| 12 | **Mood.** The research note (§11.1), then the mood layer (three axes, blocks, optional model like genre) and the dial's mood slider on real data. | 2 | L |

**Ask before building:** PR 4's dial design (the user redoes it), PR 5's fork-ahead shape, PR 6's lane order.

## 13. Anti-goals

- No second list object beside mix.
- No theory in the editor's first layer of words; theory is one hover away.
- No hidden relaxation: the generator never silently breaks a flow.
- No breaking the lineage: a mix always knows its flow, frozen or live.
