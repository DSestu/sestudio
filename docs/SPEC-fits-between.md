# Fits between: insert anywhere in the queue

Status: prototype approved 2026-11-07 (`docs/proto/music/fits-between.html`). Directions F1 (the queue is the map)
and F2 (the panel follows the music) together, plus inserting at any gap.

Today the player's **Fits next** only ranks what plays after the queue's last track. Mixing ahead means
fixing transitions *inside* the queue: a clash three tracks away, a tempo jump before the next track.

## User stories

1. **Mid-set fix.** While it plays, I see that a coming transition is rough and want a track that bridges it before it plays. Often, while listening.
2. **Where are the rough spots?** I see which transitions are rough without checking each pair.
3. **Fill anywhere.** When building ahead, I add inside the queue, not only at its end.
4. **Track first.** I have a track in mind and want to know where in the queue it fits best.
5. **Phone, one hand.** Insert into a gap with taps; dragging is optional.

## Decisions

| Question | Decision |
|---|---|
| What is rough | The app's own join model (`crates/proximity.ts`): a key **clash**, or a **tempo jump** inside one genre (`!tempoOk`, over 6 %). Not the prototype's stand-in scoring |
| Kept transitions | "Keep it as is" stores the pair (item ids) with `useKeptJoins('queue')`; a kept pair is no longer flagged |
| Which gaps | Only gaps after the playing track. Played gaps show nothing |
| Insertion point | Layer's existing `aim` (queue index an add goes to). Opening a gap sets it; the timeline's join marks already set it |
| Bridge ranking | `gapBridges`: the strict `bridges()` first (safe on both sides, tempo ok), then the rest of the library by cost, a rough side costing more. Never empty when the library has tracks |
| Anywhere ranking | Each library track at its best gap among the next 15: how much it improves on the transition it replaces |

## The queue (desktop column and phone Queue page)

- **Transition marks between rows.** Rough: a pill in the join colour ("Clash", "Tempo jump") at the right, before the
  duration. Smooth: a 5 px dot in the join colour. Unknown key: nothing.
- **Any gap is a target.** Hover shows a thin primary line and a + at the left (desktop); click opens it. On phones a tap on a
  pill opens it; any gap opens with a tap on its mark.
- **The open gap** expands in place between its two tracks (rows part, 240 ms): a head with the join ("Clash · 175 → 150 BPM"),
  the 3 best bridges each with **Insert** (and draggable), then **More in Fits next** and, for a rough one, **Keep it as is**.
  ✕ closes. Only one gap is open; it is the `aim`.
- **Insert** adds at that gap (`addTracks`, toast with Undo), closes the gap and clears `aim`, so the panel moves on to the next rough transition.
- **Rail.** An 8 px strip on the queue's right edge marks every rough transition of the whole queue, placed by queue index
  (clash and tempo jump colours), with the playing position as a line. A mark opens its gap and scrolls it into view.
- **Header count** "n rough" after "x left · y min" when n > 0.

## Fits next (desktop column, phone Library page)

A switch under the tabs: **One gap | Anywhere**.

**One gap** ranks the *focus* gap:
1. the open gap (`aim`), else
2. with **Follow playback** on: the next rough transition after the playing track, else
3. after the last track (today's behaviour).

A line above the list says which: "Coming up in 2:40 · Aurora → Best Of Me · Clash" (live countdown), "Open gap", or
"After the last track". The + on a row (and a drop) inserts at the focus gap. Follow playback off pins the gap shown.

**Anywhere** lists library tracks each with "→ between A & B" and its gain; hovering a row lights that gap in the queue; + inserts there.

## Phone

- **Coming up strip** above the Queue · Library tabs while a rough transition lies ahead: "Clash in 2:40 · Aurora → Best Of Me · 1 of 3",
  **Fix** opens that gap inline on the Queue page, › steps to the next one.
- Gaps, pills, the open gap and the rail as on desktop (marks and rail sized for a thumb).

## Not in this round

- Per-gap fit preview while dragging (drag already inserts at any gap with the drop line).
- The ruler of upcoming tracks from the prototype's panel: the countdown line carries the same information.
- Flagging rough transitions on the timeline itself.

## PRs

1. `gapBridges`, `isRough`, `bestGap` in `musicFits.ts` with tests; `FitsNext` "between" uses `gapBridges`.
2. Queue: transition marks, gap hover and open gap with Insert / More / Keep; header count; rail.
3. Fits next: One gap / Anywhere, focus gap with Follow playback and countdown; inserts at the focus gap.
4. Phone: coming-up strip with Fix.
