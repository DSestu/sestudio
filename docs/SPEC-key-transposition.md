# Transposed joins

Status: built (2026-11-07), uncommitted on feat/key-spans-everywhere. Colour: cyan oklch(82% .12 200).

## Why

Every harmony judgement in the app counts the notes two keys share (`proximity.py` `_kind`, `flows.py` `join`, the frontend `crates/proximity.ts`). Below 6 shared notes a join is a Clash (a Break in flows). A transposition, the same scale moved up or down (E minor → F# minor), shares few notes, so it always reads as a Clash, while it is one of the most used key changes. The fifths spans draw it badly too: one semitone up is 7 steps in fifths order, so the closest key change looks like the farthest.

## Stories

1. **Lift.** I put a track in the same mode a step or two higher after the playing one. The timeline tells me it is a lift up, not a clash, and the join is not amber.
2. **Drop.** I go the same mode a step lower to calm the set down. It reads as a step down, and is not flagged.
3. **Find a lift.** In Fits next I ask for tracks that lift the key, and get the same mode one or two semitones up, ranked like the other good moves.
4. **Build with lifts.** The set builder and flows treat a transposition as a move they can use (a key lift late in a set), not a clash to fix. A flow can ask for one at a join.
5. **See it.** The join panel, the popover, the join dialog and the small pairs show a transposition as the same shape moved up or down by N semitones, not as two bars far apart in fifths order.
6. **Still honest.** A join that only shares notes by accident (different modes, different shape) stays a Clash.

## Rules

- **What a transposition is:** both keys are read, have the **same mode**, and their tonics differ by d semitones, d ≠ 0, and they share fewer than 6 notes. (d = ±5 or ±7 already shares 6 notes and stays Next door; d = 0 is Same key.)
- **Which ones are good:** every transposition (d = ±1, ±2, ±3, ±4, 6) is a good join, **in any mix** (fade, cut or beat-synced blend). Both decided 2026-11-07.
- **Name:** kind `transposed`, shown as "Up 2" / "Down 1" (Plain) or "Transposed +2" (Theory), with "lift" for up and "drop" for down in the reason line.
- **Colour:** its own verdict colour, distinct from flows (green), next door (blue) and clash (amber). *(Picked in the mockups.)*
- **Camelot fallback** (a key without its harmony pass yet): same letter and 2 to 6 steps apart on the wheel (one step is a fifth: 2 steps = 2 semitones, 3 = 3, 4 = 4, 5 = 1, 6 = the tritone).
- **Ranking (revised 2026-11-08):** a transposition is a last resort, used to fix a clash, not a recommendation like shared keys. Fits next, the set builder and the fits API rank it after every shared-notes move and just ahead of a clash (notes cost 1.75: Next door is 1, a 5-shared clash 2; builder slot cost 4, after an unread key's 3, before a clash's 9). It stays a safe join, so it still counts as a clash fix. Asking for it (Fits next "Lift"/"Drop", a flow join that wants `lift`/`lower`) still puts it first. Fits next gets a "Lift" choice next to the other moves.
- **Flows:** new modulation kinds `lift` and `lower` (same mode, up or down) beside up, down, mode+, mode-, relative, break; `fit()` scores them 1 when the join wants them, 0.3 otherwise (other modulations 0.6, a break 0).
- **Drawing (picked T2 "Step", 2026-11-07):** for a transposition the panel shows two plain bars, no notes: the incoming one steps up one level per semitone (down for a drop), joined by a riser with "+N" on it, the key names under the bars, and "Same scale" over "up N semitone(s) · Lift" (or "down N · Drop"). Board: `.impeccable/mocks/key-transposition-r2/`.

## Scope

Server: `proximity.py`, `flows.py` (and their tests). Frontend: `crates/proximity.ts`, `flowFits.ts`, `musicFits.ts`, `musicFlows.ts` (KINDS), `setBuilder.ts`, `FitsNext.tsx`, `harmonyListen.ts` (panel and pair drawing), the timeline verdict colour.

Not in scope: pitch-shifting a track to make a join work.
