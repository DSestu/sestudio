# Music player: the bar opens into the stage

Status: approved 2026-11-07 (direction A, gesture map below). Mockup (interactive, from live screenshots): `docs/assets/music-player-motion.html`.

## 1. Problem

The music bar and the full-screen player (the layer) swap with no motion: `MusicPlayer.tsx` renders `<Layer />` or `<PlayerBar />`. Video already moves its player between the watch page and the mini-player with one View Transition (`App.tsx` `navigate`, `.vt-player`, 250 ms, `cubic-bezier(.4,0,.2,1)`), so you see where the player went. Music should speak the same language: **what plays grows out of its dock and shrinks back into it.**

## 2. Stories

1. Phone, couch, browsing while music plays: grab the bar and pull the player up; it follows my thumb, and I can change my mind halfway.
2. Phone: I'm done, so I pull the stage down and it shrinks back into the bar in the dock, or I press Back.
3. Desktop: click the bar or ⌃ to go into the stage; grab the immersive stage and drag it down, or ⌄, Esc, Back, to come out the same way.
4. From inside the player I jump somewhere else (rail, bell, "See all"): the player shrinks into the bar while the new page appears behind it.
5. A quick flick is enough; a short accidental drag springs back.
6. Reduced motion: the same triggers, with a short fade instead of the growing card.

## 3. The motion (direction A)

One value, the **presence** `p`, runs from 0 (the bar) to 1 (the full player). Every frame places everything from it, like the mode progress does for default ↔ expanded.

| Part | At `p` |
|---|---|
| The layer's outline | `clip-path: inset()` from the bar's rectangle to the viewport, corners 16 px → 0 |
| Layer background and sky | transparent at 0, opaque by `p = .35`, so the bar shows through the card at first. The page background fades in on the same ramp: the expanded view shows it around the stage. |
| Title | flies from the bar's title to its place: position and font size interpolate; fades in over `p` .3 → .7 |
| Play button | flies from the bar's play button to the transport's; the transport fades in over .3 → .7 |
| Everything else (timeline, queue, top buttons, crate) | fades in over `p` .15 → .65 |
| The app behind | a black scrim at `.55 × p` |

Because the title and the play button move on straight lines between two points that sit inside the card at both ends, they stay inside the growing clip the whole way.

- **Durations:** open 380 ms, close 300 ms, `cubic-bezier(.4,0,.2,1)` (the video morph's curve). After a released drag the rest of the way runs on `cubic-bezier(0,0,.2,1)`, for the remaining fraction of the duration.
- **First frame:** the layer mounts with `p = 0` and starts moving on the next animation frame, so the WebGL timeline's setup does not eat the first part of the motion.
- **Interrupt:** a new trigger turns the motion around from wherever it is (`go` from the current value). A drag that starts mid-motion catches it.
- **No bar to land in** (Stop, end of the queue, the casting bar holding the phone strip): the layer fades out and scales to 96 % instead of shrinking into a rectangle.
- **Reduced motion:** a 150 ms opacity fade, no card, no flights.
- **The TV station** never animates (`TvLayer`).
- The app behind does not scale: transforming the app root would re-base every fixed element (bar, dock, rail) mid-motion. The scrim does the stepping back.

## 4. Gestures and navigation

| Trigger | Phone | Desktop |
|---|---|---|
| **Open** | Tap the bar · **drag the bar up; the card's top edge stays under the thumb** | Click the bar · ⌃ · Enter on the focused bar · **drag the bar up with the mouse or pen; the card follows the pointer** (not from the bar's buttons) |
| **Close** | ⌄ · Back · **drag the stage down; the card shrinks with the thumb** · from expanded, a swipe goes to default first (as today) | **Immersive: grab the stage and drag down; the card shrinks with the pointer** · ⌄ · Esc (closes the crate first, as today) · Back · from expanded, a drag down goes to immersive first (as today) |
| **Release** | Past 30 % of the way, or a flick faster than 0.5 px/ms (measured over the last 100 ms) finishes; otherwise it springs back. Same 30 % rule as the mode drag (#307). | same |
| **Leave to a page** | Rail, bell, "See all": `closeThen` pops the layer's history entry and navigates on that popstate, so the new page renders behind the shrinking card. | same |

- Drag mapping: the card's top edge is `barTop × (1 − p)`, so `p = dy / barTop` while opening and `p = 1 − dy / barTop` while closing.
- **Off:** drags that start on buttons, inputs, the queue or the crate. The first 8 px pick the direction: sideways is a scrub, as today. Desktop drag up from immersive is still immersive → expanded; only a drag down from immersive closes, which today does nothing (the mode drag clamps at 0).
- Desktop stage drags stay mouse and pen only, as the mode drag is today; touch uses the phone gestures on any screen size.
- The layer opens into the last mode used (immersive or expanded); the motion is the same in both.
- After a drag on the bar, the click that may follow it is ignored for 300 ms.

## 5. State

`player.ts` keeps two flags and the motion:

- `open`: the target. It drives the Back entry, the focus move, `inert` on the app, Esc and pointer events on the layer.
- `mounted`: the layer is in the DOM. True from an open or a drag start until the closing motion settles at 0.
- `presence`: the `Presence` motion (`presence.ts`), with `go(to, now, released)`, `hold(p)`, `value(now)`, `moving(now)`.

The bar stays mounted under the layer (it is the landing target and keeps the page's `--music-bar` padding steady). Its aura stops drawing while the layer covers it.

## 6. Implementation plan

1. **Presence motion** (`presence.ts` + test, `player.ts`, `MusicPlayer.tsx`, `Layer.tsx`): the bar stays mounted, the layer mounts and unmounts around the motion, the clip, scrim, fades and the two flights; tap, ⌃, Enter, ⌄, Esc, Back and `closeThen` all animate. Reduced-motion fade, no-bar fallback.
2. **Drags** (`PlayerBar.tsx`, `Layer.tsx`): bar drag up with finger-follow, phone stage drag down, desktop immersive drag down, the release rule.

## 7. Verify

- Phone (390 × 844) and desktop (1440 × 900) in the preview: tap/click open and close, Esc, Back, rail pick in expanded, bell; drag halfway and release both ways; flick.
- `npm run build`, `npm test`, `npx tsc -b`.
- Reduced motion (emulated): a fade only.
