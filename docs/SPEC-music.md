# Spec: music (audio items, the stage, the queue, the station)

> Drafted 2026-11-02 from the discussion of that day. Mockups:
> [`docs/assets/music-mockup.html`](assets/music-mockup.html) (desktop, phone, TV; tabs A / B / C)
> and [`docs/assets/music-transition-mockup.html`](assets/music-transition-mockup.html) (the crossfade
> on the TV). They are the visual reference; where this text and a mockup disagree, this text wins.
> **The UI and UX of this feature are reviewed precisely, live, with real audio** (§8). Nothing in §6
> is final until it has been heard and seen in the lab.

## 1. Why

- sestudio plays and casts video only. Music from YouTube Music or from a folder on disk has no place
  in it, and casting it means another app on the TV.
- Playing music on a TV through a per-item cast means a cut at every track: the receiver reloads.
  The user's condition is **no cuts, smooth transitions, with animations, on the TV**.
- The pieces exist: yt-dlp, the stream proxy, the download queue, the cast routes, the Vidstack player,
  and a TV stream that swaps its ffmpeg run underneath without the TV noticing
  (`_live_piped`, `src/sestudio/web/routes/downloaded.py`).

## 2. Goals

1. **Audio is a media kind** in the interface: a track plays in the watch page like anything else,
   with a cover and a live visualiser instead of a video.
2. **A queue**: what played, what's playing, what comes next; reorder, shuffle, repeat; it keeps going
   with the album, playlist or channel the track came from.
3. **On the TV, one video flux**: the server draws the stage and streams it once. Track changes,
   skips and reorders happen inside that stream with a crossfade of sound and picture. The TV never reloads.
4. **The same picture everywhere**: the browser visualiser and the TV visualiser are the same
   algorithm, so the browser is a true preview of the TV.
5. **Review by ear and eye**: a lab page in the real app, with real tracks, where every visual parameter
   is a live knob (§8).

### Non-goals (for now)

- A music catalogue: artist / album browsing, MusicBrainz, Spotify-like search, lyrics.
- Tag editing. Titles come from tags when present, else from the file name (§4).
- Multi-room or synchronised playback on several receivers.
- Audio on the Android app beyond what the web app already does in its WebView.

## 3. How it maps onto what exists

| Concept | Existing piece | How |
|---|---|---|
| A track on disk | `downloaded.py` library, `_VIDEO_SUFFIXES`, `_MEDIA_TYPES` | Accept `.m4a .mp3 .opus .ogg .flac`; serve the raw file; `kind: "audio"` on the entry |
| A YouTube Music track / playlist | `sites/creators.py` (`youtube` site) | Same extractor. `music.youtube.com` links resolve as today; downloads add an audio-only format (`-f ba`) |
| Playing in the browser | Vidstack player, `VideoPane.tsx` | When the item is audio, the pane renders the **stage** (§5) instead of the video element |
| The queue | `castQueue.ts`, `EpisodeList.tsx` ("reads as a queue") | Becomes server-side for audio (§7); the browser edits it |
| The TV stream | `_live_piped`, `tv_run_from`, `/api/cast/live` | A **station** run: the ffmpeg run underneath is swapped at track boundaries and transitions, timestamps continuous |
| Chromecast / DLNA / Android bridge | `cast.ts`, `dlna.py`, `CastBridge.kt` | **Unchanged**: they are sent a video flux. Only metadata (title, cover) changes |
| Transcoding | ffmpeg via `imageio-ffmpeg` (`media.py`) | Encodes the frames the station renderer draws |

## 4. Audio items

- **Library**: an audio file in the downloads tree is a library entry with `kind: "audio"`. The watch
  view opens it on the stage. A folder of audio files is an album-like list: its tracks are the queue.
- **Titles**: ffmpeg tags `title` / `artist` / `album` when present. The SoundCloud test files have
  **no tags**, so fall back to the file name: `Artist - Title [id].ext` → artist + title;
  `Title [id].ext` → title only. The trailing `[digits]` is dropped.
- **Covers**: embedded art when present; else the folder's `cover.*` / `folder.*`; else a generated
  cover (initials on the ambient colour). YouTube Music gives its thumbnail.
- **Browser playback**: the raw file through the existing file route. `.m4a` (AAC) and `.opus` play in
  Chrome; Safari does not play `.opus`, which is accepted as a limit.
- **Downloads**: a YouTube / YouTube Music link gets an **Audio only** choice next to the quality;
  the queue runs yt-dlp with `-f ba` and keeps the container yt-dlp picks (m4a or opus).

## 5. The stage (the player pane for audio)

Reference: mockup A (desktop), B (phone).

- The 16:9 player pane shows: an **ambient background** (the cover, blurred, slowly drifting), the
  **cover** centred, the **visualiser**, the title and artist, the seek bar. The page keeps its header,
  actions row (`Audio · <source>`, Send to TV, Download) and right column as the watch page has them.
- **Styles**, picked in the pane's corner (glass pill group): `Bars`, `Spectrum`, `Scope`, `Cover`.
  More styles enter through the lab (§8), never straight into the list.
- **One renderer**: the visualiser is a pure function `(fft frame, params, t) → drawing commands`.
  It runs on a canvas in the browser (Web Audio `AnalyserNode` on the audio element) and in Python on
  the server for the TV (same FFT size, smoothing and decay). A test compares frame grabs of both at
  the same timestamp.
- **Parameters** (the lab's knobs; defaults to be set in the lab): bar count, smoothing, decay, FFT
  size, colour (primary by default), cover size, ambient blur / drift, transition length (default 4 s).
- **Phone**: stage, actions, then `Queue / Sources / Output` as a `Segmented` control, like the watch
  page. Leaving the page keeps the queue playing in the dock mini-player (cover, title, next, playing
  bars).

## 6. The queue

Reference: mockup A right column.

- Header: `Queue`, "n left · m min", shuffle, repeat. A **source row** under it says where the queue
  continues from when it ends (album, playlist, channel), with its badge.
- Rows: grip, cover, title, artist, duration; the playing row uses the app's active pill and a small
  playing-bars glyph; played rows are dimmed. Drag to reorder. Tap plays now (a transition, not a cut).
- For audio the queue lives on the **server** (§7) so that the TV, the phone and the desktop see one
  queue. The browser's `castQueue.ts` stays for video.

## 7. The station (the TV flux)

Reference: mockup C and the transition mockup.

- **One stream per output**: when a queue is cast, the server opens a station run and sends it as a
  live HLS (Chromecast) or a piped stream (DLNA) through the existing TV routes. The receiver loads one
  URL once.
- **Rendering**: Python decodes the current track to PCM (ffmpeg), computes the FFT, draws each frame
  with the shared renderer, and pipes frames + audio into one ffmpeg encoder (H.264 + AAC, 720p30 by
  default; 540p or 24 fps if the machine can't keep up).
- **Transitions**: `transition length` seconds before a track ends, the station mixes the tail of A
  and the head of B (equal-power crossfade), eases A's cover out and B's in, drifts the ambient colour,
  slides the title in. The visualiser reads the mixed audio, so it never stops.
- **Skip / play now / reorder**: the browser edits the server queue; a skip starts a transition now.
  The TV shows it once it has played what it had buffered (3–6 s, as for a quality change today).
  Shorter HLS segments reduce it at a CPU cost; to be measured in the lab.
- **Style change in place**: the renderer's params change at the next frame; same mechanism as
  `/api/cast/live` for quality.
- **Browser while casting**: the now-casting bar shows the device, the track, the style pills, the
  quality and the next track, with Pull back. Pull back resumes in the browser at the station's position.
- **Metadata**: the cast load carries the queue's title and the current cover, updated through the
  existing playhead / status routes so the TV's own overlay and the Android notification are right.

## 8. How this is reviewed and tested (the lab)

The UI and UX are reviewed **live, in the real app, with real audio**, not on HTML mockups.
HTML mockups are used only for layout questions, before motion or sound exist.

- **Test server**: a second sestudio instance started from a worktree, with its own config, DB and
  downloads dir, **never** the live one (`SESTUDIO_CONFIG`, `SESTUDIO_DB`, `SESTUDIO_WATCHERS=0`).
  It runs **on Windows** so the phone and the TV reach it on the LAN, with HTTPS on a fixed port
  (proposed 8444; Chromecast needs the secure origin). The URL never changes across iterations.
- **Test music**: `R:\Musique\Android\neuro soundcloud` (46 files: 42 `.m4a` AAC, 4 `.opus`; no tags;
  neuro drum and bass, sharp drops, good for tuning). The test instance's downloads dir points at a
  copy of it, so the library shows them as audio items. The same tracks are used in every review.
- **Lab page**: `#/lab/music`, in the real app with its real chrome, behind a flag that is off on
  main. It holds the stage, the queue, and a **bench panel** of live knobs (every §5 parameter,
  applied on the next frame) with **Save preset** → JSON. Presets are what gets implemented, not
  adjectives.
- **TV preview without the TV**: a toggle plays the station's own flux (real encode, real delay) in
  the browser player. Casting from the lab is the real check.
- **Offline clips**: `sestudio lab render --track … --styles …` writes the same 20 s of a track in
  every style to short MP4s for side-by-side comparison.
- **The review loop**: the agent builds into the lab and rebuilds; the user reviews on desktop, phone
  and TV and answers in **numbered items per screen**, with a timestamp for anything heard
  ("crossfade starts too late, 0:04"); each decision is logged in §9 right after; the agent proposes
  a new style as a canvas mockup in the thread first, then ports it to the bench.
- **Automated checks**: station output analysed with ffmpeg at each boundary (silence and level
  detection: no gap, no level jump); frame-grab comparison browser vs server renderer; timestamp
  continuity across the swap; unit tests on the file-name parser and the queue.

## 9. Decisions log

| Date | Decision |
|---|---|
| 2026-11-02 | Music becomes a media kind with the stage and the queue; TV gets one video flux drawn by the server; no cuts, crossfades with animations (user condition). |
| 2026-11-02 | Same renderer in browser and server, so the browser is a true preview. ffmpeg's stock visualiser filters are not used for the look. |
| 2026-11-02 | Review is live, in the real app, with real audio, from a Windows test instance; HTML mockups for layout only. |
| 2026-11-02 | Test music: `R:\Musique\Android\neuro soundcloud`. |

## 10. Risks

- **Server CPU**: one real-time 720p30 encode per cast on the Windows machine. One TV is fine; measure
  before promising more.
- **Receivers**: Chromecast's default receiver on a live HLS that runs for hours; DLNA TVs on a stream
  with no duration. Both to be checked in the first lab session; DLNA is the fallback for Chromecast,
  and vice versa.
- **Skip latency** on the TV (3–6 s) is inherent to buffering; the browser shows the change at once.
- **Python renderer speed**: if 720p30 can't be drawn in time, fall back to 540p or 24 fps.
- **Safari** does not play `.opus`.

## 11. Plan (one PR each, in order)

| # | PR | Size |
|---|---|---|
| 1 | Test instance how-to (Windows, port 8444, own config/DB/downloads) + `lab` flag + empty `#/lab/music` route | S |
| 2 | Audio items in the library: suffixes, mime types, file-name parser, covers, raw playback in Vidstack | S |
| 3 | The stage in the browser: renderer v1 (`Bars`), Web Audio analyser, ambient cover; lab bench with knobs + presets | M |
| 4 | More styles from approved presets (`Spectrum`, `Scope`, `Cover`) | S |
| 5 | Server queue for audio + queue panel (reorder, shuffle, repeat, source row) + phone tabs + dock mini-player | M |
| 6 | Station: Python renderer + ffmpeg encoder, one stream through the TV routes, style change in place | L |
| 7 | Transitions: crossfade, cover and title animations, skip-now; boundary checks in tests | M |
| 8 | Cast metadata, now-casting bar for music, pull back; TV preview toggle in the lab; offline clips command | S |
| 9 | YouTube Music: audio-only download choice, playlist as a queue source | S |

PRs 1–4 are reviewable in the browser with sound. 5–8 bring the TV. Rough total: 2–3 weeks of work
with reviews in between; §8's loop decides the pace.

## 12. Files this touches (starting points)

`src/sestudio/downloaded.py` (suffixes, mime, tags), `src/sestudio/web/routes/downloaded.py`
(`_live_piped`, `tv_run_from`), `src/sestudio/web/routes/cast.py` (`cast_live`, tracks, metadata),
`src/sestudio/sites/creators.py` (audio-only format), `src/sestudio/downloader.py` (`-f`),
`frontend/src/components/watch/VideoPane.tsx` (stage), `frontend/src/components/watch/EpisodeList.tsx`
and `frontend/src/castQueue.ts` (queue), `frontend/src/components/cast/NowCastingBar.tsx`,
`frontend/src/cast.ts` (metadata only), new `src/sestudio/station.py`, new
`frontend/src/components/music/` (Stage, Visualiser, Queue, Bench), new `frontend/src/lab/`.
