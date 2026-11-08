# Spec: Blend, one soft score for what comes next

> Status: **approved, ready to build** (2026-11-08). Board:
> [`.impeccable/mocks/blend/board.html`](../.impeccable/mocks/blend/board.html) (open at least
> 1400px wide): the visual reference for every PR below. Where this text and the board disagree,
> this text wins. Picks: **R1** for Right now, **S1** for the row sentence.

## 1. Why

- **Too strict.** `flows.py` drops a track more than ±0.2 energy or ±3 BPM away from the
  curve, and drops on colour and on a "must" genre. Only harmony is a weighted score. The
  relax ladder loosens these limits one layer at a time, in a fixed order.
- **Hard edges between close tracks.** Analysis names energy in quarters (Calm / Steady /
  Driving / Intense) and flow bricks in fifths (Calm / Low / Mid / High / Peak). Two tracks
  that sound alike can sit on either side of an edge and get split.
- **A rank, not a level.** `energyScale` is the track's rank in its own library
  (`profile.energy_score`). In a library of loud tracks, a small real difference turns into a
  large gap.

## 2. What was decided (Q&A, 2026-11-08)

| Topic | Decision |
|---|---|
| The wire | **Neighbour flow.** Each track is scored on how close it is to the *previous* track: energy, tempo, harmony, colour, genre added into one score, the **Blend**. There is no target curve to hit. |
| Direction | Each stretch of a flow **leans**: **Lift**, **Hold** or **Ease**. A lean pulls the score towards tracks a little above (or below, or level with) the previous one. |
| Limits | Per layer: **Must / Prefer / Ignore**. On energy and tempo, Must only blocks a **big jump** from the previous track. On colour and genre, Must drops a track as today. Nothing else drops a track. The relax ladder goes away. |
| Weights | Fixed and tuned by ear against the real library. Ignore = 0, Prefer = normal, Must = heavy. No sliders. |
| Energy | Measured on an **absolute** scale (loudness, highs, density), computed on read from stored bands: no re-analysis, no DB rewrite. Shown as an unnamed level (meter, curve). Every energy word goes. |
| Old flows | Curves convert on load: each stretch's slope becomes Lift, Hold or Ease, and the levels are dropped. |
| Explain | Each join on the timeline and in the queue gets one **Blend mark**. Tap or hover to see the breakdown per layer. |
| Scope | Flows (generator, lanes, Flows tab), Fits next and the queue (`proximity.py`), smart-playlist rules and the set builder, and how analysis is displayed. |

## 3. User stories

Each story names who does what and what tells them it worked. The screens come from these.

### Listening

1. **A flow that doesn't stall.** As a listener, when I play a flow over a small source (one
   album, one artist), it plays its full length without skipping close tracks over a few energy
   points. *Done when:* a flow over a 40-track album never stops short or falls back to
   "relaxed" picks just because the tracks sit at the edges of one energy band.
2. **Close tracks stay together.** As a listener, two tracks that sound equally intense can
   follow each other in any flow, Fits list or smart playlist. *Done when:* no screen sorts,
   filters or splits tracks by an energy word, and two tracks a few points apart on the new
   scale always count as close.
3. **The set still goes somewhere.** As a listener, a warm-up → peak → come-down flow still
   rises, holds, then eases, without a number it must hit. *Done when:* in the rendered mix,
   energy over a Lift stretch climbs on average and over an Ease stretch falls on average, while
   each single step stays small.
4. **No jarring jumps.** As a listener, I never hear a calm track followed by a very intense
   one, or a big tempo jump, when I asked energy or tempo to be Must. *Done when:* with Must
   on, no join steps more than the big-jump limit (starting values: about a third of the energy
   scale, about 8 BPM).

### Building flows

5. **Lanes say direction, not level.** As a flow maker, the energy lane in the editor holds
   Lift / Hold / Ease bricks instead of Calm…Peak and Build/Ease levels. *Done when:* I can
   build warm-up → peak → come-down from three bricks, and the shape preview draws the result
   from a real render.
6. **Each layer can be firm or loose.** As a flow maker, I set each lane (energy, tempo,
   colour, genre, harmony) to Must, Prefer or Ignore. *Done when:* the setting is visible on the
   lane, Ignore removes the lane's effect entirely, and Must on energy or tempo only blocks big
   jumps.
7. **My saved flows still work.** As a flow maker, flows I saved before the change open and
   play without me editing them. *Done when:* every saved flow and built-in starter loads with
   its curves converted to leans, and its first render plays.

### Reading the result

8. **See why a track came next.** As a listener, I see on each join of the timeline and the
   queue how well the two tracks blend, and can open why. *Done when:* each join carries one
   Blend mark, and tapping (phone) or hovering (desktop) shows energy step, tempo step, harmony
   join, colour and genre, each with its part of the score.
9. **Energy as a level everywhere.** As a listener, track details, the key card, explore dots
   and search show energy as a level, not a word. *Done when:* Calm / Steady / Driving /
   Intense appear nowhere in the UI, and two tracks that sound alike show levels close
   together.

### Finding what fits

10. **Fits next ranks by Blend.** As a listener, Fits next (queue, playlist edit, fits between
    gaps) ranks candidates by the same Blend score as flows. *Done when:* the best-ranked track
    in Fits next for a join is the one a flow would pick there with Hold, and "holds / lifts /
    drops" comes from the same score.
11. **Smart playlists filter softly.** As a playlist maker, an energy rule ("energy at least")
    uses the new level, and the set builder's arcs become leans. *Done when:* the rule works on
    the absolute scale and the builder's presets render as Lift / Hold / Ease.

## 4. Settled open points

| Topic | Decision |
|---|---|
| Right now | **R1**: one slider sets the level of the *first* track, then the mix holds (every pick stays close to the one before). The tempo stepper stays. Endless, as today. |
| Flow row sentence | **S1**: the moves only, from the leans and layers: "Lifts, holds, then eases out", "Holds all the way · Progressive House only", "Holds, then eases out · slows down · a break first". No energy words, no durations. |
| Row shape | Drawn from a real render (the energy of the picks), not from a target curve. |
| Big-jump limits | 33 energy points and 8 BPM (what Must blocks). |
| Tuned values (PR 9) | Weights: energy 1.5, tempo 1, harmony 1.5, colour 0.5, genre 0.5; Must ×3. Energy spread 12 points, tempo spread 5 BPM. Lean step ±10 energy points and ±1 BPM. "Holds" while the Hold part is 0.64 or more (about ±8 points). Set by a numeric pass over the 482-track library (every preset, 3 seeds): Lift stretches climb about +10 points over an hour, Ease falls about −14, the mean step is 10 points (largest 43), key matches stay near 60 %. Not yet checked by ear. |
| Half / double tempo | Not close for now (87 vs 174 is a big jump). |

## 5. Building blocks and traps

- **Energy is computed on read.** `store.py` builds `state["energy"]` (sorted loudness, highs,
  scores of the whole library) and `profile.energy_scale()` ranks each track against it. The
  absolute scale replaces the ranking with fixed reference points; the raw values
  (`profile.energy_raw`: 75th-percentile RMS, 2 kHz+ share) are already there. Nothing on disk
  changes, so no re-analysis and no migration.
- **Two copies of the rules.** `flows.py` says "the same rules live in
  `docs/proto/flows/flowgen.js`", and `proximity.py` is mirrored in
  `frontend/src/components/music/crates/proximity.ts` and `musicFits.ts`. The Blend score gets
  one Python module and one TS module, checked against **one shared JSON fixture** that both test
  suites read, so they cannot drift.
- **`relaxed` goes.** Each mix slot carries `relaxed` today (`flows.py`, `mixes.py`,
  `routes/music_flows.py`, `MixView.tsx`, `FlowStrip.tsx`). It is replaced by `blend`
  (`score` + `parts`). Remove the readers in the same PR as the field.
- **Saved flows.** Flows are stored by `mixes.flow_create/flow_update` with energy as
  `[[fraction, value], ...]` curves; presets live in `mixes.py`. Convert on read
  (`flow_get`, `flows_list`), write the new shape on the next save. A slope above +0.1 per
  stretch is Lift, below −0.1 Ease, else Hold.
- **Energy words live in many places:** `harmony.ts` (levels), `musicMeta.ts` (`energyLevel`
  type), `TrackMeta.tsx` (`EnergyMeter`), `KeyCard.tsx`, `DotCard.tsx`, `musicSearch.ts`,
  `flowWords.ts`, `FlowsHome.tsx` (`ENERGY_WORDS`), `lanes.ts` (`ENERGY`). `rg
  'Calm|Steady|Driving|Intense|energyLevel'` must come back empty after PR 1 and PR 5.
- **Live server.** None of this rewrites on-disk state. PR 3's conversion is read-side; saving a
  flow writes the new shape, which is expected.

## 6. Build plan (PRs)

Each PR ships on its own, in this order. Server and frontend parts of one story go together.

1. **Energy on an absolute scale, shown as a level** (stories 2, 9). `profile.energy_score`
   maps raw loudness and highs to 0..100 between fixed reference points (taken once from the
   current library's 2nd and 98th percentiles and written as constants); `energyLevel` goes.
   One `EnergyLevel` component (amber bar + number) replaces `EnergyMeter` and every energy
   word in track meta, the key card (with intro and outro), explore dots and search
   (`energy 80+`, `energy 70-85`). Tests: `test_music_energy.py`, `test_music_profile.py`,
   `musicSearch.test.ts`.
2. **The Blend score** (no UI). `music/blend.py` and `frontend/src/blend.ts`:
   `blend(prev, next, lean, settings) → {score 0..1, parts: {energy, tempo, harmony, colour,
   genre}, blocked}`. Fixed weights; Ignore = 0, Prefer = 1, Must = heavy; Must on energy or
   tempo blocks only a step over the big-jump limit; Must on colour or genre blocks a mismatch.
   The lean shifts the energy part's best step (Lift ≈ +6, Hold 0, Ease ≈ −6). Shared fixture
   `tests/fixtures/blend.json`.
3. **Flows pick by Blend** (stories 1, 3, 4, 7). `flows.score()` calls `blend`; energy layers
   become `[{from, to, lean}]`, each layer gets `must | prefer | ignore`; the relax ladder and
   `relaxed` go; render slots carry `blend`. Old curves and presets convert on read.
   `flowgen.js` follows. Tests: a 40-track album flow never stops short; Lift stretches climb on
   average, Ease ones fall; no join over the limit with Must.
4. **Lanes editor** (stories 5, 6). Energy palette Lift / Hold / Ease; Must / Prefer / Ignore on
   each lane (energy, tempo, genre, harmony); a tempo row ("leans with energy"); the render's
   picks as dots through the energy lane; a Blend row of rings under the lanes. Phone: stacked
   lane cards, a sheet per brick (Lift / Hold / Ease, Split, Remove).
5. **Flows tab** (R1, S1). Right now becomes the level slider + tempo stepper; `dialFlow` builds
   a first-track level and Hold. `flowWords.ts` writes S1 sentences; row shapes come from the
   render. `ENERGY_WORDS` goes.
6. **Fits next and the queue rank by Blend** (story 10). `proximity.py` judges with `blend`
   (Hold); `proximity.ts`, `musicFits.ts`, `flowFits.ts`, `queueGaps.ts`, `FitsNext`,
   `EditFits` follow. "holds / lifts / drops" comes from the energy part of the same score.
7. **Blend marks on joins** (story 8). A ring per join in the queue, the player timeline and the
   mix view, with the harmony tag and the energy and tempo steps beside it. Desktop: breakdown
   popover on hover or focus. Phone: tap opens a sheet with the breakdown, **Swap this track**
   and **Fits here…**.
8. **Smart playlists and the set builder** (story 11). `energy_min` reads the absolute level
   (the rule editor shows the level bar); `builder.py` arcs and `ArcsWay` / `SetCurve` become
   leans.
9. **Tune by ear.** Play flows and Fits on the live library; set the weights, the lean step and
   the big-jump limits; write the final values into §4 and the constants.

## 7. Checks for every PR

- `uv run pytest` for server PRs; `npm run build` and `npm test` in `frontend/` for frontend
  PRs, rebuilt right away (CLAUDE.md).
- Look at 390px and 1280px: `#/music?tab=flows`, the flow editor, the queue, the full player.
- Play a flow over one album and over the whole library; check the mix runs its full length and
  every join's ring matches its breakdown.
- Keyboard: rings and Must / Prefer / Ignore reachable with Tab; Escape closes the breakdown;
  focus returns to the ring.
