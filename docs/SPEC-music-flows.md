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

**Harmony** is the motion from the previous track, not a fixed key. Movement words in the editor; theory words on hover or in the detail.

| Movement | Key relations (Camelot) | Feel |
|---|---|---|
| Stay | same key | seamless |
| Drift | ±1 on the wheel, relative (A↔B same number) | smooth change |
| Lift | +1, or +2 (energy boost), or major from minor | brighter, rising |
| Drop | −1, or minor from major | darker, settling |
| Far | anything else, or an unrelated key on purpose | a reset |

Key confidence under .5 counts as "unknown": the generator treats the track as fitting any movement at reduced score and the row shows the key dashed, as today.

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
4. When nothing satisfies a slot, **relax and show it**: widen tempo first, then energy, then harmony (Stay → Drift → Far), then mood, then genre. The stretch shows the relaxation it needed ("tempo stretched to ±8 here"); the user can accept, pin a track, or widen the flow.
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
- Presets ship as a small starter library (names are illustrative): *Warm-up* (tempo and energy rise, Stay/Drift), *Peak* (high energy, Lift every few tracks), *Come-down* (energy falls, Drop, Drift), *Deep* (dark mood, Stay), plus layer presets (*Climb*, *Plateau*, *Wave* for curves; *Stay then Lift* for harmony).
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
2. **Next step: prototype the generator alone.** A script over the test tracks that renders a flow (curves, harmony movements, genre blocks, pins, relaxation order, seed) to a mix, so the harmony table and the relaxation rules are tested by ear before any UI. Mockups (phone and desktop) and the PR plan follow it.

## 12. Anti-goals

- No second list object beside mix.
- No theory in the editor's first layer of words; theory is one hover away.
- No hidden relaxation: the generator never silently breaks a flow.
- No breaking the lineage: a mix always knows its flow, frozen or live.
