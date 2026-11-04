# Spec: the music player (default and expanded modes)

> Agreed through nine rounds of mockups on 2026-11-02, then refined live in the working prototype on
> 2026-11-03. This document is the contract for the UI and UX of the music player page. It refines §5
> (the stage) and §6 (the queue) of [`SPEC-music.md`](SPEC-music.md); where the two disagree, **this
> document wins**. Everything about audio items, the station (TV flux), libraries, sources and sets
> (`SPEC-music.md` §13) and the review lab stays in `SPEC-music.md`.
>
> **Reference implementation: `docs/proto/music/scrub.html`.** One HTML file, inline JS and
> CSS, real Web Audio. This text describes it exactly; every number below comes from it unless marked
> otherwise. Where this text and the prototype disagree, **this text wins** (the prototype has known
> shortcuts, each marked "prototype shortcut" below, and a few things it lacks, listed in §11).
> To run it: build a folder holding `lib.json` and `lib/` (the audio), with `prep_lib.py <ffmpeg> <audio dir>
> <folder>` and then `prep_bpm.py <ffmpeg> <folder>/lib.json <folder>` (both next to the prototype), and
> serve it with `python serve.py <folder> 44391` (a static server with byte ranges, so audio can seek), then
> open `http://127.0.0.1:44391/scrub.html`. Add `?tv` for the TV picture (§9.5). The test music is
> `R:\Musique\Android\neuro soundcloud` (46 tracks).
>
> **Static mocks, layout only:** [`docs/assets/music-player-modes.html`](assets/music-player-modes.html) and
> [`docs/assets/music-player-timeline.html`](assets/music-player-timeline.html) stay as the reference for the
> layout of the two modes and for the switch between them (Default / Expanded switch, Slow motion x4). They
> are **not** the reference for the look of the flow: their Reflections look, Twilight colours, 1.5 px bass blur
> and 34 % playhead are superseded by §5.8, §5.9 and §6. Where they disagree with this text, this text wins.
>
> **Earlier audio prototype** (`index.html`, older layout): superseded by `scrub.html`, which contains the same
> crossfade engine plus beat sync.

## 1. What was decided, in one paragraph

The music player has **two modes of one page**, like the watch page's floating and pinned playlist.
**Default** is immersive: a dark sky tinted by the track's hue, with a **spectral background** (a blurred
spectrum, bass on the left to highs on the right, live from the audio, coloured by how loud each band is)
behind everything. The music runs along the floor as a **fisheye timeline**: the whole queue on one line, life
size at the playhead (8 % from the left) and compressed further out. The title is very large and the queue
**floats** in a glass sheet. **Expanded** (the queue is pinned): the light gathers into a framed **stage**, the
timeline becomes a **life-size** window inside it, and the queue **docks** as a flat column at the right.
Switching between the two is **one continuous motion** (620 ms, everything on the same beat, the same both
ways): nothing crossfades, every element travels from where it is to where it goes. The timeline draws the
**spectral balance of the whole queue as one continuous curve per band**: bass hanging below the horizon
(solid, slightly blurred), mids as a veil above it, highs in front with a fine edge line, in the **Reef**
palette, with a soft glow, a minute grid and beat ticks on the horizon. The timeline is the controller: you drag
it to scrub, tap it to jump, tap a track label to jump to it, tap a label's second line to edit that
transition. Each queue row carries a small bass / mids / highs **balance meter**. Transitions between tracks
are either a 4 s fade or a **beat sync** (tempo-matched, phrase-aligned, with a bass swap), edited per pair.

## 2. Decisions log (this page)

| Round | Decision |
|---|---|
| 1 | Of Deck, Stage, Dial, Running Row, Room: the user took **the Stage's queue column**, **the Running Row's flow as the visualiser**, and **the Room's visual simplicity**. |
| 2 | Of Split horizon, Flow floor, Cinema band, Title on the horizon, Fisheye flow: the user liked **Fisheye flow**. |
| 3 | Two modes: **default = Flow floor composition with the fisheye flow and a floating playlist**; **expanded = Split horizon**. The notion of default and expanded is the watch page's floating vs pinned playlist. |
| 4 | **The life-size view is the main flow of the expanded mode** (fisheye stays in default). Of three choreographies (One motion; Dock, gather, zoom; Zoom into now), the user chose **One motion**. |
| 5 | Of six timeline looks (Comb bars, Silk ribbon, LED matrix, Spectral bars, Track capsules, Horizon line): the user wanted **to understand the spectral balance**. |
| 6 | Of six ways to show it (Stacked bands + balance meters, Bass under the horizon, Brightness colour, Stem lanes, Aurora layers, Spectrogram): the user liked **Stacked bands + balance meters**. |
| 7 | Bar widths and palettes for stacked bands: **none liked**; the user asked to look at the **Aurora** idea instead. |
| 8 | Of five aurora treatments (Veils, Curtains, Reflections, Ridges, Pure glow): the user picked Reflections with Twilight. **Superseded** by the rows below: no reflections, Reef palette. Queue balance meters stay. |
| 9 | Bass blur was tuned live (Off, 1, 1.5, 2.5, 3.5 px). **Final: 3.5 px**, on a solid bass hanging below the horizon (the 1.5 px of round 9 is superseded). **2026-11-04: dropped**, the bass is a sharp spline like the mids and highs (no blur pass, no "Bass blur" setting). |
| — | **The timeline is one continuous spline per band across the whole queue**: the three bands are each one curve through points that sum every track's value, weighted by the crossfade (`w² · scale`, §6.4). Bass **below** the horizon (solid, blurred 3.5 px), mids as a veil above, highs in front with a fine edge line. Per-track brightness is done by clipping the one shape to each track's span (the playing track brighter). **No reflections.** Curves are taller than the old veils (amp 46 % of the strip in default, 40 % of the stage in expanded). |
| — | **A glow** drawn from the curves themselves (quarter resolution, blurred twice, dimmed to 37.5 %), under the curves. **A minute grid** (dim, soft vertical lines every minute of the timeline, fading out where the lens packs them tight). **Beat ticks** on the horizon wherever beats are at least 5 px apart, downbeats taller (§6.7). |
| — | **Timeline palette: Reef.** Seven palettes exist (§5.9); Reef is the default. The queue rows' balance meters, and the library rows' meters, use the timeline palette. |
| — | **Spectral background behind everything** (§5.8): blurred, bass on the left to highs on the right, live from the audio. The **Rollers** preset is the chosen look and the default (64 bands, 49 Hz to 18.6 kHz, attack 30 ms, release 420 ms). **Background palette: Abyss**, separate from the timeline palette. **Colour is picked along the palette by each band's intensity** (quiet = the palette's low colour, loud = its high colour), **not by frequency**. Absolute loudness is blended in (loudness weight 1), so a drop is brighter than an intro. **Size is fixed**; intensity drives colour, brightness, chroma and opacity. **Tilt 0** (no bass/highs bias). The wash is **anchored on the timeline** (each band grows up and down from the horizon). |
| — | **2026-11-04: the Drive look replaces Rollers as the default** (§5.8.7), tuned live in a lab with the test tracks. Bass in the middle (bands mirrored), mel-leaning band spacing (48 bands, 49 Hz to 12.4 kHz). The intensity follows the **track's energy from the offline analysis**, bar by bar on the beat grid, smoothed over 2 beats; live energy from the audio was tried and rejected (it reads high after a seek and does not match the analysis). Energy drives the **dynamics**, not the visibility: quiet passages keep visible, soft, slow bands; drops are sharp (release down to a 32nd note, a steeper curve, half the blur). An **auto level** stops bands sitting at the top (about 50 % of lit bands were at full before, about 14 % after). Add-on effects (sparks, shake, flashes, shockwaves) were tried and rejected as cheap; so were GPU looks (curtain, silk, nebula, field, contours). Rollers stays as a preset. |
| — | **A dark halo** (§5.8.5): the timeline's blurred shapes knock the background out around the curves (`destination-out`, strength .85, blur **3 px** in the background canvas), so the curves read against the light. |
| — | **No height change near the playhead**: the live-level swell of the veils is removed; only the playhead dot reacts to the sound (§6.8). |
| — | **Playhead at 8 %** of the width in default (was 20 %); in expanded it is `min(34 %, 1.7 × 8 %) = 13.6 %` of the stage (was 34 %). Fisheye `H` is 1500 s on desktop and 900 s on phones; the life-size window is 70 s (desktop) and 40 s (phones). |
| — | **Timeline sampling: fixed grid.** The curves are sampled on a fixed grid in each track's own time: one point per 16th note from the first downbeat (0.1 s for a track with no tempo). A point never appears, disappears or moves within its track as the music scrolls. The lens only changes how wide a window each point averages over: `max(16th, 8 px ÷ local px-per-second × 1)`, continuously, from an interpolated cumulative mean. Points closer than 1.5 px are thinned on the 2ⁿ grid. Beat sampling is on. Chosen over level-of-detail binning (steps, blended levels, continuous windows on moving points); those other methods are **not to be built**. Measured at 60 fps on a d&b drop: biggest frame-to-frame jump 15 ‰ of the curve height vs 34–51 ‰, no jumps over 2 % vs 6–14. Cost: ~1,200 points per frame on desktop. |
| — | **Highlight animates.** The playing track's queue row and timeline region brighten and fade with a 120 ms time constant when the playing track changes. While the view glides or scrubs, **every track it crosses flashes** (§6.11). |
| — | **Scrub only inside the timeline band**: the strip from `y0 − 1.02·amp − 40` to `y0 + .95·amp`; a press elsewhere on the canvas does nothing (except close the add panel). **Clicking the timeline glides** exactly like clicking a title or a row (700 ms view, 0.6 s sound crossfade). |
| — | **Drag and drop from anywhere on a row** except its buttons: mouse after 5 px, touch after a 300 ms hold (a swipe still scrolls). The grip still starts a drag at once. Library rows drag into the queue the same way. |
| — | **Adding** (redesigned 2026-11-04): the crate in the default view, the library column (desktop) or Library page (phones) in expanded, row gestures everywhere (§5.5). |
| — | **Queue animations**: adding opens a gap, then the row slides in; removing slides the row out, then closes the gap; reordering is a 420 ms FLIP and the dropped row settles from where it was released, lifted by a shadow (§7.7). The timeline morphs in step (650 ms). |
| — | **The TV picture is the desktop immersive (default) view**, drawn at 1920 × 1080, with every control removed: no options, no **+ Add** or add panel, no grips or ×, no transport buttons, no progress-bar thumb, no cursor, no transition popover. The progress line and times stay, read-only; the floating queue stays, read-only, and keeps the playing row in view by itself. Preview: `scrub.html?tv` in a 1920 × 1080 window. |
| — | **TV volume while casting.** The sender's cast button turns the player into "Playing on ‹TV›": a glass strip under the transport with a mute button and a 0–100 volume slider (wheel and ↑/↓ step 5). It sets the TV's volume (in the product: the Cast session volume, not the stream's gain). The TV shows a short volume overlay, a glass pill top-centre with icon, bar and value, held 1.6 s, whenever it changes. The visuals do not shrink with the volume. |
| — | **The TV plays every change with the same motion as the app.** Glides, add, remove, reorder, mix edits and the timeline morph all run on the TV picture too. While casting, the sound is on the TV only. |
| — | **Tempo and beat sync.** Each track gets its BPM, beat grid and first downbeat from offline analysis (§6.12). Shown lightly: "174 BPM" with a beat dot after the artist line; the tempo, small and muted, in queue and library rows. A transition is a **4 s fade** or a **beat sync** (§9.3): n bars (4 / 8 / 16 / 32, default 8) starting on a 4-bar phrase of the outgoing track, incoming track on its downbeat, **tempo match** (refused beyond ±8 %, then a 4 s fade) with a glide back to its own tempo over 32 beats, **bass swap** at the midpoint, a **nudge** in 5 ms steps (1 ms with Shift), and a phase lock. Each transition's second label line opens a small glass popover (§9.4) with these controls, a **Hear it** button and a live lock status. Settings are stored per pair of tracks; "Default mix" holds Fade / Beat sync (default Beat sync). |
| — | **2026-11-04, after the UX critique:** playing a track, album, artist, playlist or search result **no longer opens the layer**; the player bar shows and the user keeps browsing. The bar (or its expand button) opens the layer. The layer is a modal: Back closes it (history entry), focus moves to its close button, the app behind is inert, focus returns to the bar on close. |
| — | **Placement.** Music is a nav tab (Home · Media · Discover · Music · Library); Activity becomes a bell in the top card; the player is a full-screen layer with a player bar on every page (§4). Chosen over a 6-tab dock (Search off-centre) and over Music inside Media. |
| — | Not chosen and not to be built: the queue **rail** with hover peek, the **Now and next** card, staged or camera-led transitions, the **comb bars**, stacked-band bars, spectrogram, lanes, **reflections**; the sampling methods Steps, Blend levels, Continuous and Continuous-soft; the scrub modes "sound on release" and "preview, then jump"; the background alternatives to Rollers as defaults (A Wash with defaults, B Bloom, C Field, D Mirror EQ, E Aurora, F Ridge, G Waterfall, H Pulse stay only as optional presets, §5.8.6). |

## 3. Vocabulary

| Term | Meaning |
|---|---|
| **Timeline** (the flow) | The drawing of the music: **bass, mids and highs** of the whole queue as three continuous curves on a time axis around a horizon line; the playhead fixed, the music moving right to left through it. |
| **Bands** | Bass (60–120 Hz), mids (250 Hz–1 kHz), highs (2 kHz and up), each a loudness envelope from the real audio (§6.1). |
| **Horizon** (`y0`) | The line the curves hang from: bass goes down from it, mids and highs go up. Beat ticks and the minute grid sit on it. |
| **Balance meter** | The tiny three-bar glyph in a queue or library row showing a track's average bass / mids / highs (§5.4). |
| **Fisheye** | The timeline's time axis in default mode: linear-ish near the playhead, logarithmic further out (§6.2). |
| **Life size** | The timeline's time axis in expanded mode: linear, a fixed number of seconds across the stage (§6.3). |
| **Transition** (blend, mix) | How one track hands over to the next: a 4 s equal-power **fade**, or a **beat sync** (§9.3). Drawn as a **join** (a soft Signal Blue band) and a label with the next title. |
| **Sky** | The full-bleed dark background tinted by the current track's hue (§5.2). In expanded mode it is clipped to the **stage**. |
| **Spectral background** | The blurred, live spectrum behind the timeline, above the sky (§5.8). |
| **Halo** | The darkening of the spectral background around the timeline's curves (§5.8.5). |
| **Sheet** | The queue floating in glass (default). **Column**: the same queue docked flat (expanded). |
| **Track hue** | A per-track hue in the blue–violet range derived from the audio (§5.1), used by the sky. |
| **View position** (`G`, `Gview`) | A point on the queue's global time axis. The sound plays at `nowG`; the view can run ahead of the sound while scrubbing or gliding. |

## 4. Where this page lives

- **Nav order (decided 2026-11-03):** phone dock = Home · Media · [Search, centre, opens Discover] · Music ·
  Library; desktop rail = Search on top, then Home · Media · Discover · Music · Library, Settings at the
  bottom. **Activity leaves the nav** and becomes a bell with its count in the top card (phone: left of
  Settings; desktop: right end of the header card), on every page. Music icon: two beamed notes
  (lucide-style `music`, 1.8 stroke). Active state as every nav item (Signal Blue pill).
- **The Music tab** is where music is browsed (Albums / Tracks / Playlists). **The player is a layer**, not
  a page: it opens full screen over the app (the same picture as the TV) from the player bar, and a **player
  bar** stays on every page while music plays (desktop: floating at the bottom of the content; phone: a pill
  above the dock). Playing from a list does not open the layer (2026-11-04), so the user keeps browsing;
  clicking the bar opens the player; Esc / the collapse button / swipe down / Back closes it.
- The player page is what plays an audio item (a track from the library, a YouTube Music link). Route and
  component placement are the implementer's call; it reuses the app shell (rail, dock, `PageHeader`
  header card) and the glass utility (`@utility glass` in `frontend/src/index.css`).
- Dark only. All colours below are on the existing hue-240 ramp (`--b1`…`--b4`, `oklch(16%…34% .015–.025 240)`)
  plus the track hue; Signal Blue is `oklch(72% .16 230)`, its ink `oklch(18% .05 230)`.

## 5. Shared building blocks

Tokens used by the prototype: `--b1 oklch(16% .015 240)`, `--b2 oklch(20% .02 240)`, `--b3 oklch(26% .025 240)`,
text `oklch(92% .01 240)` (muted = 60 %, faint = 42 %), Signal Blue `--pr oklch(72% .16 230)`, ink
`oklch(18% .05 230)`, `--ease cubic-bezier(.2,.8,.2,1)`. Glass:
`background hsl(205 62% 14% / .66); backdrop-filter blur(24px) saturate(1.4); box-shadow inset 0 0 0 1px rgb(255 255 255 / .08), 0 8px 24px rgb(0 0 0 / .35)`
(in the product: the app's `glass` utility).

### 5.1 Track hue

`hue = 195 + p × 125`, where `p` (0…1) is the track's **percentile** in the library for brightness, measured
as the zero-crossing rate of the mono signal (decode at 4 kHz, count sign changes every 7th sample).
Percentile, not raw value, so a library of similar tracks still spreads from blue (195) to violet (320).
Computed once per track on the server and stored with the track (reference: `prep_lib.py`; the older
`prep.py` does the same).

### 5.2 The sky (background colour)

One full-screen layer under everything: `linear-gradient(to top, oklch(15% .045 h) 0%, oklch(10.5% .03 h) 45%,
oklch(8.5% .02 h) 100%)`, `h` = the hue of the track under the view position. The prototype sets `--h` every frame
from the track at the view position and it **snaps** at a track boundary (no drift); a smooth drift over the
transition is allowed and not decided (§11). In expanded mode the sky and the spectral background are clipped
to the stage (`clip-path: inset(top right bottom left round r)`, interpolated with the mode switch, §8).
Outside the stage the page is `--b1`. (The earlier radial "light" is gone.)

### 5.3 Covers (no artwork)

Not in `scrub.html` (rows show no cover); decided in earlier rounds, kept, see §11. Tracks carry no artwork. A cover is the track's
**waveform print**: a square, background `oklch(24% .05 h)`, 24 vertical rounded bars of the track's
whole-length loudness envelope (max per bin), centred on the middle line, 68 % of the height at most, fill
`oklch(76% .14 h)`, corner radius 6 px at 40 px. Real artwork, when a source has it, replaces the print.

### 5.4 Queue row

Padding 7 px 12 px; gap 10 px; font 13 px; no radius on the row. Left to right:

1. **Grip** (14 px, six dots, 30 % text, padding 4 px 2 px, cursor grab) — drag handle that starts a drag at once.
2. **Title** 13 px / 500, one line, ellipsis; under it **artist** 11 px, 52 % text, followed by the tempo as a small
   muted number (`.bpmq`: 55 % opacity, 7 px left margin, "174"; integer when within .05 of one, else one decimal).
3. **Balance meter**: three bars 4 px wide, 2 px apart, radius 2 px, bottom-aligned in a 16 px box; heights
   `max(3, value × 30)` px for the track's mean **bass, mids, highs** (§6.1); colours the **timeline palette's**
   `lo`, `mi`, `hi` (§5.9), each with `box-shadow: 0 0 6px <colour at .8>`. Tooltip "Bass, mids, highs". Shown on every row.
4. **Duration** `m:ss`, 11 px, 42 % text, 30 px wide, right-aligned.
5. **No remove button.** A row leaves the queue by gesture: a finger swipes it left (§5.4); a mouse drags it out of
   the queue panel, where the ghost and the panel edge turn red with "Release to remove"; Delete or Backspace on a
   focused row. Every removal toasts with Undo. The playing row cannot be removed.

States are driven by one number per row, `--hl` (0…1), animated (§6.11): background `color-mix(in oklch, Signal Blue hl × 22 %, transparent)`,
title colour `color-mix(in oklch, Signal Blue hl × 100 %, text)`. Rows before the track under the view are **played**: 42 %
opacity (`transition: opacity .35s`). Hover adds `rgb(255 255 255 / .05)`. Click / tap / Enter on a row (not on the
grip, not within 350 ms after a drag ended, nothing for the playing row) **glides to that track** (§6.10). Rows
are `user-select: none` and have no context menu while dragging.

**Drag to reorder** (from the grip at once, from anywhere else on the row after 5 px with a mouse or a 300 ms hold with touch, with a 12 ms
vibration; a touch that moves more than 8 px before the hold ends cancels it and scrolls instead): the row stays in place at 30 % opacity,
a **ghost** (clone, glass, scale 1.02, `0 14px 34px rgb(0 0 0 / .55)`) follows the pointer, a **drop line** (2 px Signal Blue, radius 1, a 3 px ring of
Signal Blue at 22 %, inset 10 px from the queue's sides, 80 ms move transition) shows the insertion point
(the nearest row boundary by the rows' vertical middles). The queue scrolls 8 px per move event within 50 px of its top or 40 px of its bottom. Esc or a
cancelled pointer aborts. Dropping outside the queue (more than 20 px away) does nothing. **Rules:** a dragged queue row may go anywhere,
including right before the playing row but never to its own place or the place right after it; a library row can never go above the row after
the playing one. Reordering and adding/removing are refused while a transition is running (toast "Wait for the blend to finish"). The same row
drag works from the add panel (library rows have no grip dependency, the ghost also follows horizontally).

### 5.5 Queue header and adding to the queue

Redesigned 2026-11-04 (mockups `.impeccable/mocks/add-music/v2.html`): one way to add per mode, the same row gestures everywhere.

**Header**: sticky at the top of the queue, `padding 12px 12px 8px`, gap 8 px, 13 px / 600: **"Queue"** · **"7 left · 21 min"**
(12 px, 42 % text, pushed right: tracks after the one under the view, and the minutes they last with each transition counted as 4 s).
Phones in default add a 44 px solid **"+ Add"** button (opens the crate); the desktop's expanded view adds a labelled **"Library"** lock (padlock icon, closed while locked).
Phones and short windows in expanded replace the title with two tabs, **Queue · N** | **Library**. Never on the TV.
The queue scrolls inside (`overflow-y: auto`, thin scrollbar, no overscroll chaining); phones in default do not scroll it. Its last row is a sticky
**"+ Add to queue"** (48 px, dashed Signal Blue border, solid while open, key hint **A**): the way in on desktop default, and a toggle everywhere else.
The mode switch is the pin on desktop (§7.1) and the handle on phones (§7.6); see §11 for shuffle, repeat and the "ends 21:38" clock.

**Where you add** (`Crate.tsx`; one `adding` state, read per layout; a mode switch closes it):
- **Default view, desktop and short windows: the crate**, a glass shelf along the bottom (desktop: 20 px insets, 132 px high; short: left column,
  over the transport row so the horizon stays clear, 118 px). Header: "Add to queue", library picker (when there are several), search, the aim chip,
  **Paste a link**, ×. Then a row of cards (176 px, title, BPM · duration, balance meter, ✓ when queued).
- **Default view, phones: the crate as a sheet** from 52 % of the height to the bottom (the timeline stays visible above it), with a list of rows; while a row is held it slides down out of the way (`data-libdrag`), so it drops straight into the queue sheet under it or on a join, then comes back.
- **Expanded, desktop: the library column**, flat base-200, `libRect` = `left W − 760, top 92, 360 × (H − 112)`, titled "Add from ‹library›". It slides in
  (320 ms) and **pushes the stage narrower** (`libShift` = min(380, W − 828)); title and transport shrink with it. Not a floating panel.
  **It opens on hover**: a mouse resting 250 ms on the queue (or the column) peeks it open; leaving both for 350 ms closes it (held open while a
  track is being dragged). The **Library** button (or the "+ Add to queue" row, or **A**) **locks** it open; pressing it again unlocks (back to hover).
- **Expanded, phones and short windows: the sheet's Library page** (the tabs above).

**Search across sources** (2026-11-04, mockups `.impeccable/mocks/add-music/search.html`, direction C): the search field also asks the online
sources through `useMusicSearch(query, 'all')` (YouTube Music, SoundCloud, YouTube; albums and playlists left out). A set of **stops** keeps this
machine's files apart from the streams: in the desktop column a 60 px **rail** beside the list (**PC** on top, "files", a divider, "online", then one
coloured tile per source), elsewhere a row of chips with a divider after **This PC**. Each stop shows its count, a spinner while it searches, or a red
dot (with the reason in its tooltip) when the source failed; online stops are disabled until something is typed. The list shows one stop at a time:
This PC while it has matches, else the first source that does, until you pick one (cleared with the search). Online rows and cards carry the artwork
with the source's badge and a cloud mark, and no analysis; on hover they add a **save to the library** button (`saveHit`). An online add toasts
"Adding from ‹source›…" at once, then "Added ‹title›" with Undo once the server has it. The "+" stop for new sources waits for that feature.

**Rows and cards** (the same everywhere): **tap / click = add last** (or at the aimed join); **swipe right = play next** (touch: the row follows the
finger over a Signal Blue "Play next" backing, commits past 30 % of its width with a 10 ms vibration, springs back otherwise; `swipe.ts`);
**hold 300 ms (touch) or drag 5 px (mouse) = lift**, drop into the queue at the drop line, on a timeline join, or on the **Queue** tab (= last).
Pointers that hover get two 40 px buttons (32 px on cards): **⤒** play next (ghost) and **+** add last (solid). Cards have no swipe (a sideways move scrolls the shelf).
**Queue rows: swipe left = remove** (red "Remove" backing); × stays on hover. Every add and remove toasts with **Undo** for 4 s (`adding.ts`, `toast.ts`).

**Timeline joins** (`joins.ts`): while adding or dragging a library row, the join right after the playing track shows a solid **Next** pill and the later
ones a 32 px **+** mark on the horizon (marks closer than 40 px are skipped; every join still takes a drop). Clicking one **aims** the next adds there
(chip "Adding after ‹title›", ×; it moves on after each add). Dragging over the band opens a dashed slot at the nearest join (within 90 px) with
"Plays next · in m:ss" or "After ‹title› · in m:ss". Adding a track twice is allowed (a copy is queued).
The crate closes with ×, the "+ Add" controls again, **Esc** (before Esc closes the player), a press on the timeline outside its band, or a mode switch.

### 5.6 Transport and seek

- **Seek row**: current time · 4 px bar (track `rgb(255 255 255 / .16)`, fill Signal Blue) · duration; times 12 px, 42 % text, tabular numbers. The
  hit area is 20 px tall; on hover or while dragging the bar grows to 6 px, a 14 px thumb appears and a tooltip with the time under the pointer floats 16 px
  above (11 px / 600, glass-dark). Pressing starts a **scrub of the playing track**: while dragging, the sound follows live (a seek every 90 ms with a
  0.12 s crossfade), the view follows; on release a final seek with a 0.3 s crossfade. Keyboard: ← → ±5 s, Page Up / Down ±30 s (0.3 s crossfade).
  `role="slider"` with `aria-valuenow / valuetext`.
- **Transport row** (gap 14 px, centred, 12 px under the seek row): previous (48 px, radius 12, `rgb(255 255 255 / .06)`) · **play/pause** (64 px, radius 22,
  Signal Blue, ink icon 28 px) · next (48) · **Send to TV** (48). Shuffle and repeat are not in the prototype (§11). Previous and next always blend over **3 s** from the
  start of the other track; Space toggles play (when nothing is focused).
- **Cast strip** (while casting, under the transport, 14 px gap): glass, padding 8 px 12 px, radius 14, 12 px: "Playing on **Living room TV**" (device in Signal Blue) ·
  mute button (32 px) · slider 150 px · value (26 px). The Send-to-TV button is lit (Signal Blue 24 %).
- The block is **420 px wide** on desktop; on phones the full width minus 28 px.

### 5.7 Title

Artist line 15 px, 60 % text, 4 px above the title, formed as "‹artist› · neuro soundcloud" (the folder / source) followed by the **tempo**
(§9.2). Title 96 px, weight 700, line-height .95, letter-spacing −.04em. Expanded, the same element is **scaled** to 0.73
(phones: default 0.56, expanded 0.42 of the 96 px) from its top-left corner — scaled, not re-laid-out, so it travels smoothly (§8). The prototype
keeps the title on **one line without wrapping** (`white-space: nowrap`); the earlier rule (balanced wrapping, 16 ch per line, two lines at most, ellipsis)
is kept for the product (§11). The title shows the track under the **view position** and changes instantly (the prototype has no title crossfade).

### 5.8 The spectral background

A canvas behind the timeline and above the sky. Prototype shortcut: it is drawn in a **96 × 54 canvas** scaled up to the viewport by CSS
(`filter: blur(var(--sb)) saturate(var(--ss)); transform: scale(var(--sz)); opacity: var(--so); transition: opacity .4s`), inside a wrapper that is clipped like the sky. In
the product, a small canvas scaled up is fine (it is blurred anyway) and keeps the cost negligible. It is live: it reads the `AnalyserNode` of the output (§9.1)
every frame and is silent (decays) when paused.

#### 5.8.1 Settings (the Rollers preset, the default)

Every key of `SX` after applying the `roll` preset (keys not in the preset take their default from §5.8.6):

| Key | Value | Meaning |
|---|---|---|
| `nb` | **64** | number of bands, logarithmic from `lo` to `hi` |
| `lo` / `hi` | **49 Hz / 18 600 Hz** | lowest and highest band edge |
| `att` / `rel` | **30 ms / 420 ms** | attack and release time constants |
| `sm` | **.6** | `AnalyserNode.smoothingTimeConstant` |
| `pk` | **6 /s** | how fast a band's tracked peak falls |
| `fl` | **4 /s** | how fast a band's tracked floor rises |
| `rng` | **6** | minimum range (0–255 units) between floor and peak |
| `gain` | **.85** | multiplier |
| `crv` | **1.9** | power curve on the normalised level |
| `tilt` | **0** | bass ↔ highs bias (−1…1); 0 = none |
| `lw` | **1** | loudness weight (0…1) |
| `op` | **.55** | canvas opacity |
| blur | **10 px** (CSS, screen pixels, for the Wash style) | |
| `alpha` | **.7** | intensity multiplier on every colour's alpha |
| `sat` | **1.05** | CSS `saturate()` |
| `ht` | **1.65** | height multiplier |
| `wd` | 1 | band width multiplier |
| `ch` | .16 | base chroma |
| `hue` | 0 | hue shift (degrees) |
| `lt` | 0 | lightness shift |
| `zoom` | 1.08 | CSS scale (hides blur edges); also used to map the halo |
| `spd` | 1 | motion speed (only for Aurora and Smoke) |
| `beat` | 1 | beat flash (only for Sub pulse) |
| `add` | 1 | additive blending (`lighter`) |
| `anc` | **1** | wash **anchored on the timeline** (grows up and down from the horizon) |
| `cmap` | **1** | colour from **intensity** (0 = from frequency) |
| `rx` | **1** | react by **intensity** (0 = by size) |
| `rfix` | **.75** | fixed size when `rx` is 1 |
| `swing` | **34** | lightness swing with intensity |
| `ipow` | **1.8** | intensity contrast |
| `ko` | **.85** | halo strength |
| `kb` | **3** | halo blur, in pixels of the 96 × 54 canvas (≈ 40 screen px at 1280 wide) |

Default style `wash`; background palette **Abyss** (§5.9).

#### 5.8.2 From the analyser to band levels (every frame)

`dt` = seconds since the last frame, capped at .1. Time constant step: `tc(dt, ms) = 1 − exp(−dt × 1000 / ms)`, so attack and release do not depend on the frame rate.
The analyser is `fftSize 4096` (2048 bins), `getByteFrequencyData` (0–255), `smoothingTimeConstant = sm`. When paused or no analyser: `SE[i] *= 1 − tc(dt, rel)`.

```
f0 = lo · (hi/lo)^(i/nb)        f1 = lo · (hi/lo)^((i+1)/nb)
b0 = floor(f0 / (sampleRate/2) · N)    b1 = max(b0+1, ceil(f1 / (sampleRate/2) · N))      # N = bin count
a  = mean(fq[b0 .. b1))                                    # 0..255

# auto-gain: each band reads between its own slow floor and slow peak
SP[i] = max(a, SP[i] − pk·dt)          # peak, starts at 0
SF[i] = min(a, SF[i] + fl·dt)          # floor, starts at 255
v  = clamp((a − SF[i]) / max(rng, SP[i] − SF[i]), 0, 1)
v  = v·v·(3 − 2v)                                           # smoothstep
ab = clamp((a − 110) / 120, 0, 1)                          # absolute loudness, 110..230 of 255
v  = v·(1 − lw) + v·ab·lw·1.6                              # loudness weight: a drop is brighter than an intro
v  = min(1.5, v^crv · gain · max(0, 1 + tilt·(2i/(nb−1) − 1)))
SE[i] += (v − SE[i]) · tc(dt, v > SE[i] ? att : rel)
```

`SE[i]` (0…1.5) is the band's level. Changing `nb` resets `SP`, `SF`, `SE`.

#### 5.8.3 Colour (by intensity)

Palette = the background palette's `lo`, `mi`, `hi` (Abyss: `oklch(34% .16 282)`, `oklch(64% .18 252)`, `oklch(88% .13 200)`). Only each colour's **lightness and hue** are used; **chroma
comes from `ch`**. For a band with level `E = min(1, SE[i])`:

```
t      = cmap ? E : i/(nb−1)                    # position along the palette: intensity, not frequency
hue    = (t<.5 ? hueLerp(lo, mi, 2t) : hueLerp(mi, hi, 2t−1)) + hueShift      # shortest arc
L      = clamp((t<.5 ? lerp(lo.L, mi.L, 2t) : lerp(mi.L, hi.L, 2t−1)) + lt, 0, 100)
        + (rx ? (E − .5) · swing : 0)            # louder = lighter
C      = rx ? ch · (.25 + 1.1·E) : ch           # louder = more chroma
alpha  = min(1, a · alpha · (rx ? E^(ipow − 1) : 1))
colour = oklch(L% C hue / alpha)
```

So a quiet band is dark, desaturated and near the palette's low colour, a loud one is light, saturated and near its high colour, whatever its frequency.

#### 5.8.4 Drawing the Wash anchored on the timeline

Canvas `w × h` = 96 × 54, `bw = w / nb`, composite `lighter`. `Y = y0 / viewport height × h` (the timeline's horizon), `ha = amp / viewport height`. For each band with `SE[i] ≥ .01`, `x = (i + .5)·bw`,
size `eg = rx ? rfix : SE[i]`:

```
r = min(1, eg · .95 · ht) · ha · h · 2.1
vertical gradient from Y−r to Y+r:  colour(i, 0)  →  colour(i, .55·SE[i]) at the middle  →  colour(i, 0)
fillRect(x − bw·.9·wd, Y − r, bw·1.8·wd, 2r)
```

With Rollers `min(1, .75 · .95 · 1.65) = 1`, so the size is always `ha · h · 2.1` around the horizon: **size is fixed; intensity drives colour, brightness, chroma and opacity**. Without anchoring
(`anc` 0) the same gradient grows from the bottom edge to `h − min(1, eg·.95·ht)·h`. **Prototype limitation:** on phones the wash does not look centred on the timeline; production must
centre it on the horizon at every size.

Canvas CSS: `opacity = op` (0 when the style is Off), `blur = BGB[style]` px, `saturate = sat`, `scale = zoom`.

#### 5.8.5 The dark halo

After drawing, the timeline's **glow source layer** (`Lg2`, §6.6) knocks the background out so the curves are not lost in the light:

```
save; composite = destination-out; filter = blur(kb px); globalAlpha = ko
repeat 4 times: drawImage(glowLayer, dx, dy, w/zoom, h/zoom)      # dx = w·(.5 − .5/zoom), dy = h·(.5 − .5/zoom)
restore
```

The `dx, dy, w/zoom, h/zoom` mapping places the glow layer (which covers the viewport) exactly where the viewport sits inside the zoomed background canvas. Four passes widen and
firm the cut-out; because the layer is the curves blurred, the dark follows their shape, soft at the edges. It is computed every frame; `kb` is measured in canvas pixels, so it scales with
the canvas size (a 96-wide canvas: 3 px ≈ 40 px on a 1280 px screen). In the product, if the canvas size differs, scale `kb` to keep ≈ 3 % of the viewport width.

#### 5.8.6 Other styles and presets (available, not default)

The prototype implements eight styles and eight presets; the product may expose presets later (§11). **Rollers is the default and the chosen look.** Keys not listed take the default of
this table: `nb 24, lo 30, hi 16000, att 35, rel 230, sm .55, pk 3.6, fl 1.8, rng 14, gain 1, crv 1, tilt 0, lw .5, op .62, alpha 1, sat 1.15, ht 1, wd 1, ch .16, hue 0, lt 0, zoom 1.08, spd 1, beat 1, add 1, anc 0, cmap 1, rx 1, rfix .75, swing 8, ipow 1.8, ko .85, kb 3` and blur 40 px (per-style blur defaults: wash 40, bloom 48, field 64, mirror 14, aurora 36, ridge 22, fall 30, pulse 56).

| Preset | Style | Blur | Overrides | Description |
|---|---|---|---|---|
| Drop | bloom | 40 | nb 20, att 5, rel 140, sm .3, pk 14, fl 8, rng 6, gain 1.1, crv 1.8, op .75, alpha 1.3, sat 1.4, ht 1.15 | Hard, instant hits. Made for dubstep drops. |
| Sub pulse | pulse | 60 | nb 16, lo 30, hi 8000, att 8, rel 220, sm .35, pk 10, fl 6, rng 5, gain .85, crv 2, tilt −.3, op .7, beat 1.5, sat 1.3 | The left side breathes with the kick and sub, on the beat. |
| **Rollers** | **wash** | **10** | nb 64, lo 49, hi 18600, att 30, rel 420, sm .6, pk 6, fl 4, rng 6, gain .85, crv 1.9, tilt 0, lw 1, op .55, alpha .7, sat 1.05, ht 1.65, anc 1, cmap 1, rx 1, rfix .75, swing 34, ipow 1.8 | Even, steady motion for long d&b mixes. **Default.** |
| Liquid | aurora | 52 | nb 20, att 90, rel 900, sm .75, pk 4, fl 3, rng 10, gain 1, crv 1.3, op .55, ch .2, spd .6, ht 1.1 | Slow curtains for liquid and melodic tracks. |
| Equalizer | mirror | 8 | nb 40, att 6, rel 160, sm .25, pk 12, fl 8, rng 5, gain .95, crv 1.9, op .7, wd 1.2, sat 1.3 | Sharp bars, close to a hardware EQ. |
| Neon ridge | ridge | 18 | nb 32, att 12, rel 260, sm .45, pk 10, fl 6, rng 6, gain .9, crv 1.9, op .72, ch .22, sat 1.4, ht 1.2 | One bright spectrum line on the horizon. |
| Smoke | fall | 34 | nb 28, att 15, rel 300, sm .5, pk 8, fl 5, rng 6, gain .9, crv 1.8, op .65, spd 1.4, ht 1.2 | A drifting spectrogram that rises like smoke. |
| Ambient | field | 80 | nb 12, att 200, rel 2000, sm .85, pk 2, fl 1.5, rng 12, gain .9, crv 1.2, op .45 | Barely moves. For background listening. |

Styles (colour as §5.8.3, `eg = rx ? rfix : SE[i]`, all `lighter`): **wash** bottom-anchored vertical gradient per band (alpha .55·E at the bottom to 0 at `top = h − min(1, eg·.95·ht)·h`); **bloom** radial
gradient at (band x, `Y`), radius `h·(.12 + .5·eg)·ht`, alpha .6·E; **field** full-height column per band, alpha .42·E, faded top and bottom; **mirror** a centred bar `±eg·h·.42·ht` around `Y`, `bw·.64` wide, alpha .5;
**aurora** a hanging curtain from the top, swaying `sin(t/2600·spd + i·.7)·.7·bw`, alpha .5·E; **pulse** full-height columns, alpha `.3·E·(1 − bass·.6) + .55·E·bass·k` with `bass = 1 − i/(nb−1)` and
`k = (1 − beatFraction)² · (downbeat ? 1 : .6) · beat`; **ridge** one smooth curve through the band levels (`Y − min(1.4, eg)·h·.45·ht`) filled down with a horizontal gradient of the band colours, fading
to .15 at the bottom; **fall** a spectrogram history canvas (newest row at the horizon, older rows drift up and fade; step 55 ms ÷ `spd`). The halo applies to every style.

#### 5.8.7 The Drive look (the default since 2026-11-04)

Every new knob defaults to a value that changes nothing, so the other presets look as before. Drive sets them as below (the full list is the `drive` preset in `background/settings.ts`).

**Bands.** 48 bands, 49 Hz to 12.4 kHz, edges a geometric blend of log and mel spacing (`warp` .45). The absolute-loudness window is `abLo`..`abHi` (was fixed at 110..230). After the curve, gain and tilt (tilt 0), in this order:

1. **Auto level** (`agc`): the 85th percentile of the bands, followed with a 2 s time constant (a quarter of that when rising), scales them down to `agcT` (.85) when it runs above it. It never scales up, so a quiet section stays quieter than a drop.
2. **Gate** (`gate`): `v = max(0, (v − gate) / (1 − gate))`.
3. **Soft ceiling**: linear up to `knee` (.75), then `knee + (1 − knee) · tanh((v − knee) / (1 − knee))`, × 1.08, capped at 1.

**Energy.** From the analysis served by `/api/music/tracks/analysis` (`loudness` and `bands` at 10 Hz, `bpm`, `beat0`, `bar0`): one value per beat, `0.5 · loudness + 0.5 · max(band 0, band 1)`, normalised between the track's own 10th and 85th percentiles. The value used is the mean of the bar (`eq` 2; 1 = per beat, 3 = per 4 bars), so changes land on downbeats. It is smoothed over `esm` beats (2), small changes under `dead` (.06) are ignored, and it becomes the intensity `I = efloor + (1 − efloor) · e^ecrv` (floor .3), reached instantly when rising and over `efall` beats (4) when falling. Without a tempo or the envelopes (a track not analysed yet), `I` is 1: the full-energy look.

**What the intensity bends** (`en` 1). Each dynamics knob is its normal value at full energy and eases to its "when quiet" value as `I` drops: curve 1.4 → .3, analyser smoothing .1 → .95, peak fall 20.5 → 34.5 /s, loudness weight 1 → 1, gate .41 → .12, loudness window 130–255 → 75–195. Release is a note length, geometric between `relHi` (8 beats) and `relLo` (an eighth of a beat): `relHi · (relLo / relHi)^I`. Attack × 1.8 when quiet to × .6 at full. Blur × .5 and band width × .8 at full energy. Colour reach (`eCol` 1): the palette position, chroma and brightness swing shrink with `I` (to .45, .55 and .5 of their value at `I` 0). Brightness and size do not follow energy (`eOp`, `eHt` 0). White-hot peaks (`hot` .3) scale with `I`.

**Beat accent** (`acc` .2, downbeat × 1.3): on each beat of the grid, a lift of lightness and alpha that decays over a 16th note, scaled by `I` and by the bass level, off under reduced motion.

**Drawing.** Canvas 192 px wide in the screen's shape (`res`, `asp`), intensity (`alpha`) 1.5, opacity .58, height 2.85, width 1.2, fixed size .9, halo 1. Finish: columns fade along an S-curve (`ease`); the half under the timeline at .7 (`lower`); the tips' hue drifts 14° (`hueTop`); soft sides, a sideways-only gaussian over ±2 columns in half-column steps (whole-column steps keep vertical stripes); a bloom, the frame blurred by a 22nd of its width at .12 behind it; film grain (`grain` .12), a tile of light and dark specks moved every frame (no blend mode: the background is its own stacking context).

### 5.9 Timeline palettes

Each palette has `lo` (bass, below the horizon), `mi` (mids veil), `hi` (highs in front) and `edge` (the fine line on the highs), as `oklch(L% C H)`. **Reef** is the timeline default.
The background has its own palette choice (**Abyss**, default) or "Same as timeline".

| Palette | `lo` | `mi` | `hi` | `edge` |
|---|---|---|---|---|
| Twilight | `42% .16 300` | `70% .15 355` | `87% .12 75` | `95% .07 75` |
| Lagoon | `40% .14 255` | `68% .12 200` | `90% .09 180` | `97% .05 180` |
| Glacier | `38% .13 265` | `70% .11 232` | `93% .05 205` | `98% .02 205` |
| **Reef** (timeline default) | `44% .11 215` | `74% .13 188` | `90% .13 155` | `97% .07 155` |
| **Abyss** (background default) | `34% .16 282` | `64% .18 252` | `88% .13 200` | `97% .06 200` |
| Tide · gold | `40% .14 258` | `70% .12 195` | `88% .12 85` | `96% .06 85` |
| Studio blue | `36% .12 248` | `72% .15 230` | `93% .06 215` | `98% .03 215` |

Queue and library balance meters use the timeline palette's `lo` / `mi` / `hi`.

## 6. The timeline

### 6.1 Data

- **Band envelopes**: per track, **8 band envelopes at 10 values per second**, computed on the server once per track and served with the queue (reference: `prep_lib.py`, `prep_bands8.py`):
  decode mono at 16 kHz; filter with one-octave band-passes centred on **60, 120, 250, 500, 1000, 2000, 4000 Hz** and a high-pass at **7000 Hz** (`ffmpeg bandpass=f=C:width_type=o:w=1`,
  `highpass=f=7000`); RMS over each 0.1 s window (every 8th sample); normalise **each band by its 98th percentile across the whole library** (not per track, so a bassier
  track really shows more bass), cap at 1, round to 2 decimals. The three drawn bands are means of these: **bass** = bands (60, 120) · **mids** = (250, 500, 1000) · **highs** = (2000, 4000, 7000+).
  The client builds, per group, a **cumulative array** `cum[g][i+1] = cum[g][i] + mean(group at i)` and the track's mean per group `bal[g] = cum[g][n] / n` (the balance meter).
- **Loudness envelope** (covers, §5.3; not drawn): RMS at 10 values per second from a 4 kHz decode, normalised to the track's 98th percentile, capped at 1.
- **Track fields** the prototype's `lib.json` carries: `id, src, title, artist, folder, dur, hue, env, bands (8 × n), bpm, beat0, bar0, bpmConf` (§6.12). On load, `bar0` is
  normalised into the first bar: `b = bar0 mod (4 beats)`, minus one bar if `b` is within .06 s of a bar, floored at 0.
- **Global time axis.** Each track `i` starts at `TS[i]`; `TS[0] = 0`, `TS[i+1] = TS[i] + mixOut_i − startOff_{i+1}` where `mixOut_i` is the moment in track `i` where the transition to `i+1` starts (its
  own time) and `startOff_{i+1}` the moment in track `i+1` it enters at (§9.3). A 4 s fade has `mixOut = dur − 4`, `startOff = 0`. The view position `G` lives on this axis; `nowG = TS[cur] + current time of the playing element`.
- **Audible span of a track in its own time** (`span`): enters at `i0 = startOff of its incoming plan (0 for the first)` over `il = that plan's length (4 s for the first)`, leaves at `o0 = mixOut of its outgoing plan (dur − 4 for the last)`
  over `ol = that plan's length`. Weight at track time `o`: 0 outside `[i0, o0 + ol]`; `sin((o − i0)/il · π/2)` in `[i0, i0 + il]`; `cos((o − o0)/ol · π/2)` in `[o0, o0 + ol]`; else 1 (equal power, the same curve as the audio).

### 6.2 Fisheye mapping (default)

Rect `d` (the flow strip): desktop `x 0, y = H − min(420, .47 H), w = W, h = min(420, .47 H)`; phones (width < 760 px) `x 0, y 60, w W, h .56 H − 144` (under the close button; the title sits in the 84 px below it, above the transport). With `px = d.x + d.w · PH` (**PH = .08**, the playhead), `B = 14` s,
`H0 = 1500` s on desktop (900 s on phones) and a past horizon of 180 s:

```
A  = (d.w·(1 − PH) − 8) / ln(1 + H0 / B)         # right of the playhead
AL = max(4, d.w·PH − 4) / ln(1 + 180 / B)        # left of the playhead
x(s) = px + A  · ln(1 + s / B)    for s ≥ 0
x(s) = px − AL · ln(1 − s / B)    for s < 0
s(x) = sign(d)·B·(exp(|d|/k) − 1), d = x − px, k = A or AL      # the inverse, used by scrubbing
```

**Ticks** (default), 10.5 px, `oklch(92% .01 240 / .42)`, baseline 8 px above the strip's bottom: `−1 min`, `+1 min`, `+5`, `+10`, `+20 min` at their `x(s)`, only where `R.x + 16 < x < R.x + R.w − 40` and `|x − px| > 36`.

### 6.3 Life-size mapping (expanded)

Rect `e` (the stage): desktop `x 128, y 92, w = W − 128 − 400, h = min(520, .62 H)`; phones `x 14, y 88, w W − 28, h min(250, .3 H)`. Linear: `x(s) = px + s · (e.w / win)` with `px = e.x + e.w · PHE`,
`PHE = min(.34, PH · 1.7)` (**13.6 %** with PH .08), `win = 70` s (desktop), `40` s (phones). Ticks at 16 px above the stage's bottom: `−20 s`, `−10 s`, `+20 s`, `+40 s`, `+60 s`
(same filters as §6.2).

### 6.4 Sampling: one continuous curve per band, fixed grid

**Interpolation of the two modes.** Per frame, with `t` the mode progress (0 = default, 1 = expanded, eased, §8):

```
R        = lerp(d, e, t)  for x, y, w, h            # the rect the timeline lives in
X(s)     = lerp(fisheye.x(s), lifesize.x(s), t)
px       = lerp(fisheye.px, lifesize.px, t)
y0       = lerp(d.y + d.h·(.58 + hz), e.y + e.h·(.68 + hz))          # the horizon; hz = 0
amp      = lerp(d.h·.46, e.h·.4) · ht                                  # curve height; ht = 1
```

At 1280 × 800: default `y0 ≈ 642`, `amp ≈ 173`; expanded `y0 ≈ 429`, `amp ≈ 198`; phone 390 × 844: default `y0 ≈ 380`, `amp ≈ 101`, expanded `y0 ≈ 258`, `amp ≈ 100`.
`frame.band = [y0 − 1.02·amp − 40, y0 + .95·amp]` is the scrub band (§6.10).

**Items.** For each queued track `i`: its screen-time offset `a = TS[i] − G` (plus, during a queue morph, a decaying offset, §7.7) and its scale `sc` (1; during an insert `me`, the morph progress;
for the moved row `1 − .45·sin(π·me)`; for a just-removed ghost `1 − me`). Draw only items with `sc > .001`, sorted by `a + i0`.

**One point list for all tracks.** Each track emits points over its own range `[lo, hi]` in its own time, so overlapping tracks do not double up:

```
s0 = span.i0 ; s1 = min(dur, span.o0 + span.ol)                       # audible span
prevEnd  = previous item's a + min(its dur, its o0 + ol)              # (−1e9 if none)
nextStart = next item's a + its i0                                    # ( 1e9 if none)
lo = (prev && prevEnd > a + s0) ? min(s1, (a + s0 + prevEnd)/2 − a) : s0       # up to the middle of the overlap
hi = (next && a + s1 > nextStart) ? max(lo, (nextStart + a + s1)/2 − a) : s1
skip the item if X(a+hi) < −40 or X(a+lo) > W + 40
if lo == s0: add the point [X(a+s0), 0, 0, 0]                          # curve starts from zero at the very start
if hi == s1: add the point [X(a+s1), 0, 0, 0]                          # and ends at zero at the very end
```

**The fixed grid** (the only method to build). `base = 15 / bpm` (one 16th note; **beat sampling on**) anchored at `anc = bar0` (the first downbeat); for a track with no tempo `base = 0.1` s, `anc = 0`.
`i` runs from `ceil((lo − anc)/base)` to `floor((hi − anc)/base)`; for each `i`, with `tt = anc + i·base`, `x = X(a + tt)` (points left of −40 px are skipped, the loop stops past W + 40):

```
dens = max(1e-3, |X(a+tt+.25) − X(a+tt−.25)| · 2)           # local pixels per second
n    = max(0, floor(log2(1.5 / (base · dens))))              # thinning level: points closer than ~1.5 px
if n > 0 and i mod 2ⁿ ≠ 0: skip the point                    # kept on the 2ⁿ grid, so a point never moves
wt   = max(base, psp / dens · win)                           # window width in seconds; psp = 8 px, win = 1
value[g] = cov(g, a + tt − wt/2, a + tt + wt/2)  for g = bass, mids, highs
```

A point never appears, disappears or moves within its track as the music scrolls (the same `tt` forever); only `wt` changes, continuously with the lens.

```
cov(g, s0, s1) = Σ over items j covering the window:
                  o0 = max(0, s0 − j.a) ; o1 = min(j.dur, s1 − j.a) ; skip if o1 ≤ o0
                  w  = weight(mid of [o0,o1], j.span)
                  w² · j.sc · meanF(j, g, o0, o1)

meanF(x, g, a, b) = (C(b) − C(a)) / (B − A), with C(t) = linear interpolation of cum[g] at t·10 (clamped to [0, n]), A = clamp(a·10), B = clamp(b·10)
                    # the interpolated cumulative mean: a window edge moving by a hair moves the value by a hair
```

`w²` makes the sum equal-power (`sin² + cos² = 1`), so a blend of two similar tracks does not dip or bump. Typical cost ~1,200 points per frame on desktop.

**From points to curves.** Sort the points by `x` (during a reorder tracks can overlap; values are positional sums). Smooth each band with a **5-tap triangular filter** (weights 1, 2, 3, 2, 1, normalised, skipping missing neighbours; `smr = 2`).
Then one **Catmull-Rom spline** through all points per band (converted to cubic Béziers with tangents `(next − previous)/6`). Heights:

```
bass  : y = y0 + v · klo · amp      klo = .7      (hangs below the horizon)
mids  : y = y0 − v · kmi · amp      kmi = .9
highs : y = y0 − v · khi · amp      khi = .42
```

Each is a filled area closed on `y0` (`moveTo(x0, y0)`, the spline, `lineTo(xN, y0)`); the highs also have an open stroke path along the top for the edge line.

**Per-track brightness (highlight).** The one shape is painted once per **region** (a run of tracks with equal brightness), clipped to `[X(a+lo), X(a+hi)]` rounded, with `globalAlpha = alpha · hm`,
`hm = .6 + .4 · HL(track)` (§6.11): the playing track is full brightness, the others 60 %. Adjacent regions with `|Δhm| < .02` are merged.

### 6.5 Layers and treatment

Everything is in screen pixels of the page (`W × H`, device pixel ratio capped at 2 for the main canvases). Back to front:

| # | Layer | Drawn on | Colour | Alpha | Blur | Blend |
|---|---|---|---|---|---|---|
| 1 | Joins (§6.7) | page canvas | Signal Blue | gradient 0 → .22 → 0 | none | normal |
| 2 | Minute grid (§6.7) | page canvas | white | ≤ .09 | none | normal |
| 3 | Beat ticks (§6.7) | page canvas | white | .22 / .42 | none | normal |
| 4 | Glow (§6.6) | offscreen | the three colours | `min(1, glow · .5)` (+ a second pass if `glow · .5 > 1`) | quarter-res 14 px + 7 px | `lighter` |
| 5 | Bass | offscreen | `lo` | `alo = .9` × `hm` | **3.5 px** | normal |
| 6 | Mids | offscreen | `mi` | `ami = .5` × `hm` | none | normal |
| 7 | Highs | offscreen | `hi` | `ahi = .82` × `hm` | none | normal |
| 8 | Highs edge | offscreen | `edge` | 1 × `hm`, stroke **1 px** (`edge = 1`) | none | normal |
| 9 | Playhead and dot (§6.7, §6.8) | page canvas | white | | | |

The offscreen canvas is composited onto the page twice: the part **left of the playhead** at **42 %** opacity, the part right of it at 100 %. The page canvas is clipped to the light (the stage in expanded). To keep the cost down, the veil
layers are drawn only in the vertical band `from max(0, y0 − 1.5·amp) to min(H, y0 + 1.05·amp)`. Bass is drawn on its own layer at CSS-pixel resolution and blurred once with `ctx.filter = blur(3.5px)`; mids, highs and the
edge share one layer. Two blurs per frame in total (bass and glow).

### 6.6 Glow and halo source

A quarter-resolution layer (`GQ = .25`) is painted with the **same curve shapes** (bass `lo` at alpha 1, mids `mi` at .8, highs `hi` at .7, each × `hm`, additive). That layer then feeds:

1. **The glow**: onto a second quarter-res canvas with `lighter`, `blur(14px)` at alpha 1 plus `blur(7px)` at alpha .45 (14 px at a quarter ≈ a 56 px halo on screen); that canvas is scaled up to the page
   and drawn first onto the offscreen canvas with `globalAlpha = min(1, glow·.5)`. **Default `glow = .75`** (so alpha .375). The glow sits under the curves.
2. **The halo** (§5.8.5): the second canvas is the layer that knocks the spectral background out.

### 6.7 Minute grid, beat ticks, joins, playhead

- **Joins**: for each item `i ≥ 1`, from `X(a + i0)` to `X(a + i0 + il)`, a rectangle `y0 − 1.2·amp` tall `2.1·amp`, horizontal gradient `oklch(72% .16 230)` at 0 → **.22** → 0.
- **Minute grid**: vertical lines on whole minutes of the timeline's own clock (`m·60 − G`, `m` from `ceil((G − 200)/60)` while `m·60 ≤ G + 1600`), over `[y0 − 1.1·amp, +2.05·amp]` with a
  vertical white gradient 0 → 1 → 0. Per line: `sp = |X(sm + 60) − X(sm)|` (pixels per minute), `alpha = .09 · clamp((sp − 8)/30, 0, 1)`, × .6 left of the playhead; skipped under .003 or outside the rect. Drawn
  twice: a 3 px line at `.4·alpha` (soft) and a 1 px line at `alpha`.
- **Beat ticks** (Beat grid on, the default; tracks with a tempo only): for each audible beat `bar0 + n·(60/bpm)` within [−200 s, +1600 s]: 1 px wide white, height `±9 px` on downbeats (`n mod 4 = 0`, alpha .42) and `±4 px` on other beats (alpha .22), × .6 left of the playhead, centred on `y0`.
  A tick is drawn where beats are **at least 5 px apart**; where beats are tighter, only downbeats are drawn while bars are at least 6 px apart (`4 × beat spacing ≥ 6`); beyond that the walk stops.
- **Playhead**: a 2 px vertical line from `y0 − 1.35·amp`, height `2.2·amp`, white with a vertical gradient (0 → .9 at 65 % → 0); a dot on the horizon at radius `5 + level · 9` px, white at `.35 + level · .5` (§6.8).
- **Hint chip**: while dragging or gliding the timeline, a glass chip above the playhead (`y0 − 1.35·amp − 40`): "‹title› · 1:23 / 4:56" (the track at the view position).

### 6.8 Liveness

The curves **never change height** with the live sound. The only live element is the **playhead dot**: `level` = mean of analyser bins 8 to 191 divided by 255, smoothed `level = .7·level + .3·new` per frame (decays ×.95 when paused). Reduced motion: keep the timeline moving
(it is content), drop the dot's pulse. The spectral background (§5.8) is the other live element and is not part of the timeline.

### 6.9 Transition labels

Above each visible join: the incoming title (12 px / 600, `oklch(92% .01 240 / .92)`) at `y0 − 1.02·amp − 22`, and under it (11 px / 500, Signal Blue) at `y0 − 1.02·amp − 8`:
**"in 0:26 · 8 bars · +0.4 %"** (sync with a tempo change), **"in 0:26 · 8 bars · synced"** (sync, tempos equal) or **"in 0:26 · 4 s blend"** (fade), where the time is `a + i0` seconds from now, and the text reads **"later"** instead of "in m:ss" at 10 minutes or more.
The label's left edge is the join's start + 6 px. **Thinning**: walk the joins left to right and show a label only if its x is between `px + 30` and `W − 100` and at least **200 px** after the last shown one, and skip it if its box would overlap the floating queue sheet.
The hit box is `x … x + max(titleWidth, 120) + 12`, `y − 14 … +32`: **a press on the upper part (above `titleY + 3`) glides to that track; on the second line it opens the transition popover** (§9.4). The label under the pointer gets a
`oklch(72% .16 230 / .16)` rounded (8 px) background and a brighter title. Labels appear on phones too in the prototype (the earlier "no labels on phones" rule is open, §11).

### 6.10 Scrubbing and jumping

All of it on the timeline canvas, ignored while the mode is switching (`0 < t < 1`) and ignored outside the **scrub band** `frame.band` (a press outside only closes the add panel). The cursor is `grab` (`grabbing` while dragging, `pointer` over a label, default outside the band).

- **Drag (default scrub: "Grab · live sound")**: pressing at `x` remembers `sg = s(x)` (the time under the pointer, from the current mapping: fisheye in default, life-size in expanded, switching at `t > .5`) and the view position `g0`. After **4 px** of movement, the view position
  is `g = clamp(g0 + sg − s(x))`: the point you grabbed stays under the pointer. While dragging the sound **follows live**: a seek every **90 ms** to `g` (crossfade .12 s, §9.2). Esc cancels and returns to `g0` (crossfade .2 s).
- **Release with inertia (on)**: velocity `vel` (seconds of timeline per ms, from the last two moves); if `|vel| > .002`, the view keeps gliding with `v = vel · 16` per frame, multiplied by **.9** each frame (≈ 158 ms time constant; the prototype's step is per frame, production
  should use the time constant) until `|v| < .01`, clamped to `[0, end]`, then the final seek (crossfade .4 s). Without inertia the final seek happens at once.
- **Tap (no drag)**: on a label see §6.9; elsewhere (tap to jump, on) **glide** to the time under the pointer.
- **Glide** (title click, queue row, timeline tap, label, "Hear it", TV mirror): the view position eases to the target over **700 ms** (`cubic-bezier(.2, .8, .2, 1)`, the target advancing with real time while playing), and the sound crossfades to it over **.6 s**
  (§9.2). A transition in progress that is not the target's is ended at once.
- **Clamp**: `[0, TS[last] + dur[last] − .5]`.
- Prototype review aids (not product): the other scrub modes, "sound on release" (the master gain ducks while dragging) and "preview, then jump" (a ghost playhead), are not to be built.

### 6.11 Highlight

`HL[track]` (0…1) is the playing track's highlight; the playing track is the one **under the view position** `G` (`trackAt(G)`: the last track whose `TS ≤ G`). Every frame, with `ez = 1 − exp(−dt / .12)` (**120 ms time constant**):
`HL += (target − HL) · ez`, target 1 for the track under the view, else 0. **Flash**: if the view moved more than 1 s inside one frame, every track whose span lies between the previous and the new view position is lifted to
at least **.75** first, so a glide or a jump flashes everything it crosses and then fades. `HL` drives the queue row's `--hl` (§5.4) and the timeline's `hm = .6 + .4·HL` (§6.4). Rows before the playing track get the "played" 42 % opacity.
On the TV the queue also scrolls itself so the playing row sits `56 px` below the header (`scrollTop += (want − scrollTop) · min(1, 1.5·ez)` per frame).

### 6.12 Tempo analysis (offline, `prep_bpm.py`)

Per track, on the server (numpy; the prototype uses 6 processes). Adds `bpm` (2 decimals), `beat0` (s, the first beat), `bar0` (s, the first downbeat), `bpmConf`.

1. Decode mono at **11 025 Hz**; frames of 1024 samples, hop 110.25 (100 frames/s), Hann window; `logm = log1p(1000 · |FFT|)`.
2. **Onset strength** = sum over bins of the positive frame-to-frame difference of `logm` (spectral flux); the **kick** curve is the same sum over 30–150 Hz. Subtract a 0.5 s (50-frame) moving average from the onset curve and clip at 0.
3. **Tempo**: for each `bpm` from 70 to 200 in 0.1 steps, the mean over lags 1 to 8 beats of the autocorrelation of the onset curve at that lag, times a **log-normal prior** `exp(−.5 · (log2(bpm/140) / .6)²)` (so 87 / 174 resolves to the faster one for d&b).
   `bpmConf` = best score ÷ mean score.
4. **Refine**: sweep ±1.5 BPM in 0.02 steps; for each, a sub-frame pulse train (all phases in half-frame steps) laid over the whole onset curve; keep the tempo whose best phase sums highest.
5. **Phase** (`beat0`): the phase of that pulse train with the highest sum. **Downbeat** (`bar0`): of the 4 beat phases, the one with the most **kick** energy summed over whole bars: `bar0 = beat0 + k · 60/bpm`.

Expected on the 46 test tracks: BPMs such as 172 / 174 / 175, within ±0.1 (`SPEC-music.md` PR 3).

## 7. The two modes

Reference frame below: desktop 1280 × 800, phone 390 × 844 (`small` = viewport width < 760 px). On other sizes keep the rules (columns, gaps, proportions), not the pixels.

### 7.1 Switching

- On desktop the mode is chosen with a **pin** in the queue header (the prototype has no pin: its Options bar switches the mode, a review aid); unpinned = default, pinned = expanded. On phones the sheet's **handle** (36 × 4 px bar at the top of the queue) does the same: **tap** or **swipe up** (> 40 px) in default
  opens the list; in expanded, **pull the list down past its top** to return (§7.6).
- The mode is a **persisted preference**, like the watch page's playlist (see `frontend/src/playlistCollapsed.ts`): its own key, default **unpinned**.
- The switch is reversible at any time, **including mid-motion**: a new switch retargets from where every element currently is (`tFrom = t`), never a restart from the end state.

### 7.2 Desktop, default (floor + fisheye)

| Element | Where | What |
|---|---|---|
| Sky + spectral background | the whole page, under the nav rail | §5.2, §5.8 |
| Nav rail | as everywhere (84 px glass rail at 12 px insets) | Music item active |
| Top row | x 128, y 18, full content width | glass back button (40) · "Music · neuro soundcloud" (13 px, 60 % text) · right: **Send to TV** glass chip · ⋯ glass button. **No header card** in this mode. (Not in `scrub.html`, kept from the earlier rounds.) |
| Title | x 136, y 118 | artist line + 96 px title (§5.7) |
| Seek + transport | x 136, y 250, 420 px wide | §5.6 |
| Queue sheet | left `W − 20 − w`, top 72, `w` × 430 with `w = clamp(W − 590, 350, 525)` (1.5 × 350 on a wide screen) | **glass**, radius 16, header §5.5, rows §5.4 from the first track of the queue (played ones dimmed), scrolling |
| Timeline | full page width, the bottom strip `d` (§6.2) | fisheye; `y0` at 58 % of the strip, `amp` 46 % of it; playhead at 8 % of the width; labels and ticks |

The sheet floats over the sky and over the top of the timeline; nothing else covers the timeline.

### 7.3 Desktop, expanded (life size)

| Element | Where | What |
|---|---|---|
| Sky + spectral background | clipped to the **stage**: x 128, y 92, `(W − 528) × min(520, .62 H)`, radius 12 px | same layers; outside the stage the page is `--b1` |
| Header card | x 128, y 12, full content width, 64 px | the app's `PageHeader` glass card: back · title + "‹artist› · neuro soundcloud" (artist in Signal Blue) · search field · ⋯. The top row of default is gone. (Not in `scrub.html`.) |
| Title | x 154, y 116 | same element at scale .73 |
| Seek + transport | x 128, y = stage bottom + 14, 420 px wide | same block |
| Queue column | left `W − 380`, top 92, 360 × (`H − 112`) | **flat**: background `--b2`, no blur, no shadow, radius 8 px; more rows visible because it is taller |
| Timeline | inside the stage | life size §6.3; `y0` at 68 % of the stage, `amp` 40 % of it; playhead at 13.6 % of the stage width; ticks |
| Library column (when open) | left `W − 760`, top 92, 360 × (`H − 112`); the stage gives up to 380 px | §5.5 |

Stage and column share the top edge; the column is 360 px wide with a 20 px gap to the stage; the seek/transport block sits 14 px under the stage.

### 7.4 Phone, default

| Element | Where | What |
|---|---|---|
| Sky + spectral background | full screen | §5.2, §5.8 |
| Top row | x 14, y 14 | glass back button · right: **TV** glass chip (not in `scrub.html`) |
| Title | x 22, y 76 | artist line + title scaled .56 (≈ 54 px) |
| Seek + transport | x 14, width `W − 28`, y = strip bottom + 14 (strip `d`: y .30 H, h .26 H) | seek row above transport |
| Timeline | full width, strip `d` | fisheye with `H0 = 900` s, playhead at 8 %; `y0` 58 %, `amp` 46 % of the strip |
| Queue sheet | left 12, width `W − 24`, top `H − 170`, height 150, radius 16 | glass; the **handle** at the top (sticky), the header below it (sticky, `top 22 px`), rows from the first queue row; the rest is cut off (no scroll in default) |
| Dock | as everywhere | Music active |

### 7.5 Phone, expanded

| Element | Where | What |
|---|---|---|
| Header card | top, the app's phone top card | back · title + artist · cast button (not in `scrub.html`) |
| Sky + spectral background | clipped to the stage: x 14, y 88, `(W − 28) × min(250, .3 H)`, radius 12 | |
| Title | x 32, y 102, scale .42 | inside the stage |
| Timeline | inside the stage | life size, 40 s across, playhead at 13.6 % |
| Seek + transport | x 14, width `W − 28`, y = stage bottom + 12 | |
| Queue list | left 14, width `W − 28`, top = stage bottom + 120, height `H − (stage bottom + 132)`, radius 8 | flat `--b2`; the handle at its top; rows from the first queue row; scrolls |
| Dock | as everywhere | |

### 7.6 Phone gestures

- **Default to expanded**: tap the handle, or swipe the sheet up by more than 40 px.
- **Expanded to default**: with the list scrolled to its top, pull it down. The pull is **continuous**: for a pull of `d` px, `p = min(1, d/120)`, `ease = 1 − (1 − p)²`, and the mode progress is `t = 1 − .35 · ease` (the layout follows under the finger, CSS transitions off while pulling);
  the handle bar widens from 36 to `36 + 30·p` px; at `d ≥ 120` it is **armed** (the bar turns Signal Blue with a 220 ms bump). On release: armed → default, else back to expanded, each with the normal 620 ms motion. Works with touch, the mouse wheel (`d −= deltaY · .6`, released after 180 ms of no wheel) and a mouse drag.
- Not available while a row is being dragged or while the mode is switching.
- Adding is the crate sheet in default and the Library page in expanded (§5.5); a mode switch closes either.

### 7.7 Queue add / remove / reorder animations

All with `cubic-bezier(.2, .7, .2, 1)`, in the queue and in the timeline at once.

| Operation | Queue row | Timeline |
|---|---|---|
| **Add** | **560 ms**: the gap opens first (height 0 → full and padding 0 → 7 px, 42 % of the time, row still invisible at `translateX(48px)`), then the row slides in (opacity 0 → 1, `translateX(48px)` → 0) | **650 ms** (`cubic-bezier(.2,.8,.2,1)`): the new track grows in (`sc` 0 → 1) while the other tracks glide from their old to their new places |
| **Remove** | **500 ms**: the row slides out first (opacity 1 → 0, `translateX(48px)`, 50 % of the time), then the gap closes (height → 0, padding → 0) | **650 ms**: the removed track shrinks (`sc` 1 → 0) at its old place while the others glide |
| **Reorder** | **420 ms FLIP**: every row slides from its old position to its new one; the **moved row starts where it was dropped** (the drag ghost's top), `position: relative; z-index 2`, lifted by `0 10px 28px rgb(0 0 0 / .45)` shadow that fades to none | **650 ms**: the moved track dips (`sc = 1 − .45·sin(π·me)`) while the others glide |

Moving the playing track keeps playing it (the index follows). The timeline's glide offset for a track is `oldRelativeTime − newRelativeTime` decaying with the 650 ms eased progress.

## 8. The switch: "One motion"

**Every** moving part uses the same duration and easing, with no delay, in both directions:

- **Duration 620 ms**, **easing `cubic-bezier(.2, .8, .2, 1)`** (the app's `--ease-smooth`). The timeline's own progress `t` uses the same curve (solved in JS) and the CSS transitions on the title, controls and queue use the same 620 ms.
- **Under `prefers-reduced-motion: reduce`**: no travel; the two layouts swap with a 150 ms opacity crossfade (not in the prototype).

What moves (all simultaneously):

| Part | From → to |
|---|---|
| **Timeline** | fisheye → life size by interpolating the mapping (§6.4). The playhead slides from 8 % of the page to 13.6 % of the stage; the far future slides out to the right of the stage; the horizon and amplitude move with it. Blur and blend settings do not change. |
| **Joins, playhead, dot, labels, grid** | travel with the timeline's interpolated `X(s)`. |
| **Ticks** | fisheye ticks and life-size ticks both exist; their alpha is `|t − .5| · 2`, so they fade out through the middle of the motion and the other set fades in, each travelling with `X(s)`. |
| **Sky and spectral background** | `clip-path: inset(0 0 0 0 round 0)` → `inset(<stage rect> round 12px)`. The picture itself does not move or rescale. The timeline canvas is clipped to the same rect. |
| **Queue** | its box animates left / top / width / height / radius (16 → 8 px), its background from glass to `--b2`, its shadow to none. The rows inside do not re-lay out; more of them come into view as it grows. |
| **Title** | moves to the stage corner and scales 1 → .73 (origin top left). |
| **Seek + transport** | translate from under the title to under the stage. |
| **Top row ↔ header card** | the top row fades out while moving up 14 px; the header card fades in while moving down from −20 px (and the reverse). (Product only.) |
| **Phone** | the same: the sheet grows into the list, the sky clips to the stage, title/seek/transport travel. |

What does **not** move: the nav rail, the dock, the sky's gradient, the music itself (the timeline keeps scrolling during the switch).

## 9. Playback rules the UI relies on

### 9.1 Audio graph

Two `<audio>` elements (`preservesPitch = true`), each: `MediaElementSource → BiquadFilter (lowshelf, 180 Hz, gain 0 dB) → GainNode → master GainNode → AnalyserNode (fftSize 4096) → volume GainNode → destination`.
The analyser sits **before** the volume node, so the visuals do not change with the volume. The AudioContext is created on the first user gesture (the prototype shows a "Play neuro soundcloud" button; in the product the play press does it). A 40 ms `setInterval` runs the engine. A transition
schedules **equal-power curves** (`setValueCurveAtTime`, **48 points**: `cos(p·π/2)` on the outgoing gain from its current value, `sin(p·π/2)` on the incoming) on both gains over its length. The idle element is loaded when the transition starts (**prototype shortcut**:
no preload; production preloads the next track in the idle element before its transition).

### 9.2 Transport behaviours

- **Next / previous / glide / scrub step**: `xfade(track, offset, length)`. Next and previous: the target track at 0 over **3 s** (prototype; the earlier `min(blend length, 3 s)` is the same for the 4 s default). Row click, label click, timeline tap and Hear it: glide, sound crossfade **.6 s**. Scrub steps: .12 s (live), final seek .3–.4 s (bar / drag release).
  A seek inside the playing track just sets `currentTime`.
- **Seeking is allowed during a transition** in the prototype: a new `xfade` ends the running one at once and starts the new one. Adding, removing and reordering are refused during a transition (toast "Wait for the blend to finish"). **Pausing during a transition ends it at once** (the incoming track takes over), then pauses.
- **Automatic transition**: the engine starts the planned transition when the playing element reaches `mixOut` of the current plan (§9.3): `xfade(next, startOff + (now − mixOut)·rate, plan.len, plan)`.
- The title shows the track under the view position and the hue follows it; there is no title crossfade in the prototype (§11).

### 9.3 Mixing: fade or beat sync

Per pair (outgoing `a`, incoming `b`) a **plan** is computed whenever the queue or the pair's settings change (`retime`). Settings (`mixOf`): `{ mode: 'sync', bars: 8, tempo: true, swap: true, nudge: 0 }` as the **default mix** (`MIXD`), overridden by the pair's stored settings.

```
fade  plan: { mode: fade, mixOut: a.dur − 4, len: 4, startOff: 0, rate: 1 }
if mode ≠ sync or a.bpm or b.bpm missing: fade
r = a.bpm / b.bpm
if tempo-match on and |r − 1| > .08: fade (why = "tempo")                    # tempos too far apart
beat = 60/a.bpm ; bar = 4·beat ; len = bars · bar
n = floor((a.dur − .3 − len − a.bar0) / (4·bar))                             # whole 4-bar phrases that fit
if n < 0: fade (why = "short")
sync plan: { mixOut: a.bar0 + n·4·bar,                 # the start of a 4-bar phrase of the outgoing track
             len,                                       # bars × bar, with bars 4 / 8 / 16 / 32
             startOff: max(0, b.bar0 + nudge/1000),     # the incoming enters on its downbeat (+ nudge)
             rate: tempo-match ? r : 1 }                # incoming plays at a's tempo
```

During a **sync** transition (`xfade`): the incoming element's `playbackRate = plan.rate`; with **bass swap** on, the incoming low shelf starts at **−26 dB**, then at the **midpoint** of the transition it goes to 0 dB and the outgoing one to −26 dB, both with
`setTargetAtTime(…, midpoint, .04)` (the two basses never add). At the end the low shelves return to 0. If the rate was not 1, the incoming rate **glides back to 1 over 32 beats (8 bars) of its own tempo** with smoothstep `p²(3 − 2p)`.

**Phase lock** (every 40 ms during a sync transition, once the incoming element can play): the beats since the incoming's downbeat must equal the outgoing's since the mix point:

```
e = (inc.t − startOff)/beat(b) − (out.t − mixOut)/beat(a) ;  e −= round(e)       # error in beats, −.5..+.5
errMs = e · beat(a) · 1000
if |e| > .25 beat: jump the incoming by −e·beat(b) seconds (lock = off)
else: inc.playbackRate = plan.rate · (1 − clamp(e·.3, −.03, +.03))              # bend the tempo at most ±3 %
lock = |errMs| < 12
```

**Display of the plan**: the join's width is `len`; the label (§6.9) shows the mode, bars and the tempo change (`±x.x %`) or "synced"; with `why = "tempo"` or `"short"` the pair is shown as a fade and the popover says why.

### 9.4 The transition popover

Opened by a press on a label's **second line** (§6.9) (a glass popover, width 296 px, padding 12, radius 14, 12 px text, opacity/translate 200 ms), placed at the label's x (clamped 8 to `W − 312`) and 40 px under its top. Closes with ×, Esc or a press outside (a press on the timeline closes it and keeps working as usual).
Contents:

1. Header: "‹outgoing title› → ‹incoming title›" (13 px) and ×.
2. Line (muted): "174 → 172 BPM · −1.1 %".
3. **Mix**: segmented **Fade** | **Beat sync**.
4. **Length**: **4 | 8 | 16 | 32 bars** (disabled unless Beat sync).
5. **Tempo**: **Match** | **Off** (disabled unless Beat sync).
6. **Bass swap**: **On** | **Off** (disabled unless Beat sync).
7. **Nudge**: **−** [ "+5 ms" ] **+** (steps of 5 ms; **1 ms with Shift**; disabled unless Beat sync). It moves where the incoming track enters.
8. Footer: a status line and **Hear it**. Status: the reason when the plan fell back ("Tempos 9.1 % apart, fading instead", "Track too short for that length, fading instead"), else "6.9 s · on the downbeat" (sync) or "4 s equal-power fade"; while that very transition is playing: **"Locking · +3 ms" / "Locked · +1 ms"**. **Hear it** glides to
   8 s before `mixOut` (`glideTo(TS[k] + mixOut − 8)`), so the transition starts on its own 8 s later.

Every change updates the plan at once: the timeline morphs (650 ms), queue rows re-time. The settings are **stored per pair** (`outgoingId>incomingId`) and sent to the TV; they also apply when the pair comes up again (prototype: `localStorage`; production: on the server queue,
`SPEC-music.md` PR 4). The **Default mix** control (Fade 4 s | Beat sync) sets the default for every pair without its own stored mode (in the product: in the player's options; a pair keeps only the fields it changed).

### 9.5 The TV and casting

- **The TV is the desktop default view** at 1920 × 1080, with controls removed (`?tv`; §2). In the prototype the sender and the TV are two windows of the same page and talk over a **`BroadcastChannel('sestudio-cast')`**: the sender posts operations only while casting
  (`ins {id, at}`, `rm {k}`, `mv {from, to}`, `mix {key, v}`, `mixd {v}`, `go {k, off}`, `vol {vol, muted}`), the TV never replies. **Prototype shortcut:** in the product the TV renders from the **server queue and station** (`SPEC-music.md`): it receives the same operations as pushes from the server, and its position
  comes from the station's clock, not from messages.
- **Sound** while casting is on the TV only: the sender's output gain is 0 while casting (the analyser still runs there). TV gain = `(VOL / 100)²` (a perceptual curve), 0 when muted. Prototype shortcut: the TV's volume is its stream gain; in the product it is the **Cast session volume**.
- **Controls on the sender**: the Send-to-TV button toggles casting (lit, label "Stop sending to TV", toast "Playing on Living room TV"); the cast strip (§5.6) has mute, the slider (default 60), wheel ±5 on the slider, ↑/↓ ±5 anywhere when casting.
- **Volume overlay on the TV**: a glass pill, top-centre (`top 40 px`), padding 12 px 18 px, radius 16: speaker icon (waves reduce below 45, a cross at 0 or muted) · a 240 × 6 px bar (Signal Blue, 150 ms width transition) · the value (15 px, 34 px wide; "Muted" when muted). Fades in over 250 ms, **held 1.6 s** after the last change.
- Queue edits on the TV apply even to the playing row (`rm` is honoured), and all animations (§7.7, glides, the morph) play there too.

## 10. Accessibility and states

- Every control is a real button with a label (Previous, Play or pause, Next, Send to TV / Stop sending to TV, Drag to reorder, Add music, Play next, Add to the queue, Mute / Unmute the TV, TV volume).
  Space toggles play. (The earlier N shortcut for "next" is not in the prototype.)
- The queue is a list; the playing row has `aria-current="true"` (**not in the prototype**). Reorder also works with the keyboard (move up / move down in the row's menu) (**not in the prototype**; required in the product).
- The timeline is decorative (`aria-hidden`) in the product (the prototype's canvas has an `aria-label`); the seek row carries the position as a slider (`aria-valuenow`, `aria-valuetext`).
- Focus rings: 2 px Signal Blue, 2 px offset.
- **One track in the queue**: the timeline shows the one track ending; no joins; no labels.
- **Loading** a queue: the timeline shows a flat horizon; rows show skeletons (not in the prototype).
- **End of queue**: the timeline ends at the last track's end (`.5 s` before), the playhead stops there. Repeat is not in the prototype.
- **Reduced motion**: §8; no beat-dot pulse, no playhead-dot pulse; the timeline keeps scrolling; the spectral background stays on (it is content), or drops to a static wash if the user also disables it in settings (not decided).
- **Touch**: no hover is involved except the remove × (always visible at 60 % on touch) and the seek tooltip.

## 11. Open points (not decided; ask before choosing)

**Prototype defaults the user never explicitly confirmed:**

- **Scrub mode "Grab · live sound"** (the sound follows the finger every 90 ms), **inertia on**, **tap to jump on**, **playhead 8 %**, **glow .75** (Medium), minute grid strength (.09), beat ticks on, sampling constants (psp 8 px, win 1), **default mix = Beat sync / 8 bars / tempo match / bass swap on**. All are the prototype's defaults; the Scrub / Inertia / Playhead / Glow / Tap options are review aids.
- **Queue-row highlight colour with the Reef palette**: the playing row's `--hl` background (Signal Blue at 22 %) and title colour (Signal Blue) clashed visibly in one session: the playing row became a solid cyan block hiding its title. Needs a fix (lower the background mix, or use text colour only) and a check against all palettes.
- **Phone performance** of ~1,200 points per frame plus two blurs, a 96 × 54 background and the glow layers: not measured on a mid phone. Budget in `SPEC-music.md` PR 8 (ask if over 8 ms per frame).
- **The centred wash on phones**: the wash does not look centred on the timeline on a phone in the prototype (accepted as a prototype limitation); production must centre it on the horizon (§5.8.4).
- **Whether the Look presets are exposed to users** (background styles and presets, background palette, timeline palette, sampling): the prototype exposes them in a "Look" panel; the product may keep them behind the lab flag, or expose only presets / palettes.

**In the earlier text, not in the prototype (kept unless asked, to be confirmed):** the **legend** chip (Highs · Mids · Bass); **cover** thumbnails in rows (§5.3); **shuffle, repeat and the "ends 21:38" clock** and the **pin** in the queue header (the prototype shows "N left · M min" and a "+ Add" chip); the **top row / header card** and their swap; the **title crossfade** during a blend and the sky's **hue drift** (the prototype changes the title and hue instantly);
the **N** shortcut; **balanced two-line wrapping** of the title (the prototype uses one line, `nowrap`); **no labels on phones** in default (the prototype shows them); "at 21:18" clock times in labels (the prototype says "later" at 10 minutes or more); `aria-current`, keyboard reorder, loading skeletons, reduced-motion swap.

**Other:**

- **Source row** ("neuro soundcloud · keeps going when the queue ends") from SPEC-music §6: not in the prototype. Keep it out unless asked. Libraries, sources and sets: `SPEC-music.md` §13.
- **Long titles** beyond two lines, and very long queues (fisheye beyond 25 minutes).
- **Tablet / touch desktop**: the floating sheet's size on narrow desktops (< 1100 px) is not designed; `small` is a single 760 px breakpoint.
- **Transition length** shown in labels follows the plan (4 s fade or n bars); the fade length is fixed at 4 s in the prototype (the earlier "setting 1–12 s" is not implemented).
- **Seeking and pausing during a transition**: the prototype ends the transition at once (§9.2); the earlier rule was to disable seeking and to finish the blend before pausing.
- **Timeline Reset** in the prototype's Look panel resets the timeline palette to Twilight, not to Reef (a prototype bug; the default is Reef).

## 12. How to check an implementation against this

1. Run the prototype (see the header) and the implementation side by side at 1280 × 800 and 390 × 844, both modes, with the **Reef** timeline palette, the **Abyss / Rollers** background and the default options (Beat grid on, Glow Medium, Playhead 8 %).
   Positions within a few pixels, sizes, colours, and type as above. For layout only, also `docs/assets/music-player-modes.html`.
2. Play a d&b section: the background breathes with the music (bass left, highs right), a drop is clearly brighter than an intro, and the dark halo follows the curves. Scrub across tracks: the curve never jumps (no frame-to-frame jump over 2 % of the curve height at 60 fps), points do not shimmer, the minute grid fades where the lens compresses.
3. Click a title, a row, the timeline and a label: all glide the same way (700 ms), every track crossed flashes. Drag from the middle of a row, from the grip, and from the add panel (touch: hold 300 ms): the drop line, the ghost, then the 420 ms settle.
4. Add a track (gap, then slide in), remove one (slide out, then gap closes), and edit a transition's mix, length, tempo, bass swap and nudge: the timeline morphs, the label updates, **Hear it** lands 8 s before the mix, the status shows Locking, then Locked within ±12 ms.
5. Turn on Slow motion x4 in the static mock and slow animations x4 in Chrome DevTools for the implementation: the same parts move the same way, all on one beat, none fades where the mock travels. Switch mid-motion: it reverses from where it is. On phones, pull the list down past its top.
6. Open `?tv`-style TV picture at 1920 × 1080 and cast: every change plays there; the volume pill appears for 1.6 s.
7. Review with the user, live, with the test music (`R:\Musique\Android\neuro soundcloud`), per SPEC-music §8.

## Appendix: review aids (lab only, not product)

The prototype carries two panels the user used to tune and review; **in the product they live behind the existing `lab` flag on `#/lab/music`** and nothing else of them ships by default.

- **Scrub options bar** (top centre): Mode (Default / Expanded), Background (Off, A Wash, B Bloom, C Field, D Mirror EQ, E Aurora, F Ridge, G Waterfall, H Pulse, "Presets…"), Default mix (Fade 4 s / Beat sync), Beat grid (On / Off), Scrub (live / on release / preview-then-jump), Inertia, Bass blur (Off / 1 / 1.5 / 2.5 / **3.5** px), Playhead (5 / **8** / 12 / 20 %), Glow (Off / Soft .45 / **Medium .75** / Strong 1.1), Tap to jump.
- **Look panel** (button top-left, key **T**): tabs Background (background palette, presets, a live band meter, fine-tune sliders for every key of §5.8.1 with double-click to reset) and Timeline (palette, sampling methods, shape sliders: Height, Horizon, Bass depth, Mids height, Highs height, Smoothing, Bass / Mids / Highs opacity, Edge line, Glow,
  Bass blur, time ↔ beats, Method, Point spacing, Window width), **Copy** (the changed values as JSON) and **Reset**. Settings persist in `localStorage` (prototype shortcut).
- Other prototype shortcuts that production replaces: `localStorage` for the queue, the playing track, the mix settings, the Look and palette preferences (production: the server queue and the user's settings); `BroadcastChannel` for casting (production: the server queue and station); a static `lib.json` (production: the analysis table of `SPEC-music.md` PR 3); test hooks `window.__pts`, `window.__X`, `window.__sm` (not product).
