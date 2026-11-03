# Spec: music (audio items, the stage, the queue, the station)

> Drafted 2026-11-02 from the discussion of that day. Mockups:
> [`docs/assets/music-mockup.html`](assets/music-mockup.html) (desktop, phone, TV; tabs A / B / C)
> and [`docs/assets/music-transition-mockup.html`](assets/music-transition-mockup.html) (the crossfade
> on the TV). They are the visual reference; where this text and a mockup disagree, this text wins.
> **The player page's UI and UX are specified in [`SPEC-music-player.md`](SPEC-music-player.md)** (default and
> expanded modes, the fisheye and life-size flow, the switch); it replaces §5 and §6 below where they differ.
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

> **Superseded** by [`SPEC-music-player.md`](SPEC-music-player.md) (the player layer, the timeline, the
> spectral background). Kept for history; do not build the styles below.

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
| 2026-11-02 | Player page after four mockup rounds: default = light + fisheye flow on the floor + floating queue; expanded (pinned) = stage with life-size flow + docked column; one 620 ms motion between them. Full detail in SPEC-music-player.md. |
| 2026-11-03 | Nav: Home · Media · Discover · Music · Library; Activity becomes a bell in the top card; the player is a full-screen layer with a player bar on every page (SPEC-music-player.md §4). |
| 2026-11-03 | Ready for later (§13): several libraries in a **side column** (layout B), tracks keyed by library + source, playlists as a tree with parts and cross-source items, offline analysis incl. structure, one search across sources with per-source sub-search. Mockups: `docs/assets/music-future-mockups.html`. |
| 2026-11-03 | Audio items (PR 2): track id = first 16 hex of sha1(library id + NUL + path relative to the library), so it survives rescans and moving the root but not a rename inside it; tags and duration come from `ffmpeg -i` (no ffprobe is bundled); audio is listed as one group per folder with `kind: "audio"`, never regrouped into shows. |
| 2026-11-03 | Analysis v1 (PR 3): numpy is a dependency. Raw measurements live in `music_analysis` (float16 envelopes, one row per track id) in the library DB (migration 3); the library-wide 98th-percentile norms and the sorted brightness list are in `music_state` and rebuilt when the analysed set grows by more than 10 % or on `POST /api/music/analysis/renormalise`. Hue is the track's brightness percentile against that list at read time, so a new track needs no rerun. Workers are threads (not processes) so numpy's thread pools cannot multiply; BLAS threads are pinned to 1. The job is kicked at startup and on every listing; it analyses files whose mtime or size changed and does not retry a failing file until it changes. Tempo is left unset under 8 s. The prototype's numbers are reproduced exactly (46 test tracks: max BPM difference 0.00). |
| 2026-11-03 | Server queue (PR 4): one station, the whole queue as a JSON document in `music_queue` (library.db, migration 2); push = Server-Sent Events at `/api/music/queue/events` (a `state` snapshot, then one event per change named `ins`/`set`/`rm`/`mv`/`go`/`mix`/`mixd`/`transport`, `id` = rev, a ping comment every 15 s); mutations carry `If-Match: <rev>` or `?rev=` and get 409 plus the current state when stale; `set` is the replace-the-queue op; next/prev are pushed as `go`; per-pair mix settings are keyed `"<from track id>><to track id>"`. |
| 2026-11-03 | Player layer (PR 7): **one tab makes the sound**, the most recent one where play was pressed (a per-page-load id in `localStorage` `music.soundTab`); every other tab mirrors the queue on screen and stays silent, and a reloaded tab makes no sound until play is pressed in it. Every change goes through the queue API; the engine only follows the SSE state. The automatic transition is a 4 s fade started by the sound tab at `dur - 4`, followed by a `next` call (the `go` event it causes finds the blend already running). Next/prev are told apart from a row click by the `playing` field on their `go` event (3 s vs .6 s blend). Track titles come from `/api/downloaded` (audio entries carry `id`); analysis from `/api/music/tracks/{id}/analysis` when it exists (absent: no tempo, meter or beat dot, default hue 215). The "+ Add" chip is hidden until the add panel (PR 10). |
| 2026-11-03 | Analysis v2 (PR 20): DSP heuristics only, numpy only, in `music/profile.py`; results live in `music_analysis.extra` with a `v2` version (bump `profile.VERSION` to redo all), the chroma is kept there so the key can be redone without decoding, and tracks analysed before v2 are profiled from their stored row plus one decode. Key = peak-picked, log-weighted chroma (60 Hz-5 kHz) correlated with the 24 Krumhansl-Kessler rotations, confidence = margin to the runner-up. Energy per bar = 70 % loudness + 30 % high share. Structure = cuts on the 4/8/16-bar grid (min 8 bars) from a band-balance + energy novelty curve, labelled by rules (drop = high energy; intro = low first; outro = low last; buildup = rising low before a drop; breakdown = other lows). Genre = rule scores over tempo, band balance, energy variance and mid roughness; confidence under .7 is doubtful. **Known limits:** the key leans on kicks and sub bass (the 46 test tracks land almost all on 5A and 10A, mean key confidence .27), so treat it as a hint under .5; tempo is taken as detected (no half-time handling, a wrong octave gives a wrong genre); structure needs a steady grid and 8+ bars, a track with tempo changes or no kick drifts; labels cannot tell a second verse from a drop; genre knows only a handful of electronic genres, everything else falls to "Electronic" (.25). |
| 2026-11-03 | Timeline (PR 8): the canvas is `fixed inset-0 -z-10` inside the timeline slot, so it covers the whole layer (all coordinates are page pixels, §6.5) and sits above the sky but under every control. Analyses come from the batch `GET /api/music/tracks/analysis` (40 ids per request); tracks the server has not analysed yet draw flat and are asked again every 15 s. Pixel density: DPR capped at 2 (1.5 under 760 px), and lowered by 0.5 down to 1 when frames average over 25 ms for 90 frames. Compositing is limited to the curves band plus 64 px of halo. The handover plan is a function (`layoutQueue(tracks, planOf)`), a 4 s fade until PR 12; the glide flash of §6.11, hover and hit boxes of labels are left to PR 10. |
| 2026-11-03 | YouTube as music (PR 16): a streamed track is the queue item `{library: "online", source: "youtube" or "ytmusic", track_id: "yt:<video id>", title, artist, duration}`, its metadata kept in the item (no table); a bare item is looked up with yt-dlp, one that carries a title is trusted. `GET /api/music/online/{id}/audio` resolves the best audio stream (cached an hour) and 307-redirects to the existing signed stream proxy, so the audio is same-origin for Web Audio; the first fetch also analyses the track once in the background (audio fetched to a temp dir, analysis saved under the track id, the audio deleted at once: no cache to size). `GET /api/music/online/link?url=` expands a video or a playlist (first 200) into queue items; the client replaces or appends with the normal queue POST. Audio-only download: `-f ba[ext=m4a]/ba` (m4a preferred, a webm is remuxed to .opus), output `<name>.%(ext)s`; not offered for "This device". |
| 2026-11-03 | Several libraries (PR 19): the registry is in `config.json` (`music_libraries`: `{id, kind: local_folder / remote_sestudio / ytmusic_account, label, path / url, token}`); `local` (the download root, "This PC") is implicit and its track ids are unchanged, any other folder hashes its own id in (`sha1(library id + NUL + path)`). The analysis runner also walks every folder library. A remote sestudio server is read through `/api/music/share/*` (listing with metadata, per-track analysis, audio with ranges), protected by a per-server bearer token: tokens are made in Settings (`/api/music/share-tokens`), shown once, stored as a SHA-256 hash and revocable; it is the only part of the API that asks for credentials. The client keeps the last listing on disk (`music_remote/<id>.json`), marks the library offline with the time of the first failed contact, retries every 60 s, proxies audio (Range passed through) and asks the remote for analyses on demand rather than caching them. Remote track ids are `<library id>-<remote id>`. YouTube Music account: `ytmusic_cookies` (a cookies.txt path, Settings) lets yt-dlp list the likes playlist (first 500, cached 10 min) as online items; no file reads as "needs sign-in". The UI filters by `crate` (the library list) because a YT Music like is queued as `library: "online"`. Smart lists now draw from every folder library; remote and YT Music tracks are not in smart lists yet. |

## 10. Risks

- **Server CPU**: one real-time 720p30 encode per cast on the Windows machine. One TV is fine; measure
  before promising more.
- **Receivers**: Chromecast's default receiver on a live HLS that runs for hours; DLNA TVs on a stream
  with no duration. Both to be checked in the first lab session; DLNA is the fallback for Chromecast,
  and vice versa.
- **Skip latency** on the TV (3–6 s) is inherent to buffering; the browser shows the change at once.
- **Python renderer speed**: if 720p30 can't be drawn in time, fall back to 540p or 24 fps.
- **Safari** does not play `.opus`.

## 11. Plan (one PR each; agents pick them from the tracking issue)

Rewritten 2026-11-03; replaces the 9-PR plan, whose stage styles (`Bars`, `Spectrum`, `Scope`, `Cover`)
were superseded by the player in [`SPEC-music-player.md`](SPEC-music-player.md).

**How to work a PR.** Read this section, then the spec sections it names. The reference implementation
is the prototype `docs/proto/music/scrub.html`.
Copy its numbers, not its code structure. Ship behind the `lab` flag until PR 12 removes it. Review
happens live with real audio (§8). A PR that needs a decision marked **Ask** stops and asks the user
before building that part. Commit, PR and merge rules are the repo's (`CLAUDE.md`).

**Sizes:** S ≈ half a day, M ≈ 1–2 days, L ≈ 3–5 days of agent work plus review.

### Phase 0: groundwork

| # | PR | Needs | Size |
|---|---|---|---|
| 0 | **Prototype in the repo.** Move `scrub.html`, `serve.py` and the `prep_*.py` scripts from `.impeccable/mocks/music-proto/` to `docs/proto/music/`, with a `README.md` saying how to rebuild `lib.json` from a music folder (`prep_lib.py`, then `prep_bpm.py`) and serve it (`serve.py <dir> 44391`). `lib.json` and audio stay out of git (`.gitignore`). Remove the test hooks (`window.__pts`, `__X`, `__sm`). | — | S |
| 1 | **Test instance and lab.** How-to for the Windows test instance (port 8444, own `SESTUDIO_CONFIG` / `SESTUDIO_DB` / downloads dir, `SESTUDIO_WATCHERS=0`) in `docs/`; a `lab` flag (off on main) and an empty `#/lab/music` route. | — | S |

### Phase 1: audio items and analysis (server)

| # | PR | Needs | Size |
|---|---|---|---|
| 2 | **Audio items.** `.m4a .mp3 .opus .ogg .flac` in `downloaded.py` (suffixes, mime types); `kind: "audio"`; tags via ffprobe, else the file-name parser of §4 (`Artist - Title [id].ext`); raw playback through the existing file route. **Every entry gets `library` and `source` fields** (one library, "This PC", source `file`) and a stable track id (§13.1). Tests: the parser on the 46 test names, mime types, the id's stability across rescans. | 1 | S |
| 3 | **Offline analysis v1.** A background job per audio track, run on indexing and when files appear: 8 band envelopes at 10 values/s normalised by the library-wide 98th percentile (`prep_bands8.py`), loudness envelope (`prep.py`), track hue (zero-crossing percentile, SPEC-music-player §5.1), tempo, beat0, bar0 and confidence (`prep_bpm.py`). Results in **their own table keyed by track id**, with room for more fields (§13.3); an API that serves them in compact form; progress visible on the Activity bell. Percentile normalisation re-runs when the library grows by more than 10 %. **Ask:** numpy as a dependency (the prototype needs it; check the Android proot build) versus pure ffmpeg filters. Tests: the 46 test tracks give the prototype's BPMs (172/174/175…, ±0.1). | 2 | M |
| 4 | **Server queue for audio.** The queue lives on the server (§6): references to tracks (`library` + track id), never paths; current index, position, per-pair mix settings (SPEC-music-player beat sync). API: get, add (at index), remove, move, play-now, mix settings. Changes are pushed to every client: phone, desktop and TV. **Ask:** push channel (SSE vs polling; the app has none today). Tests: ops, concurrent edits, persistence across restart. | 2 | M |

### Phase 2: the player in the browser

| # | PR | Needs | Size |
|---|---|---|---|
| 5 | **Nav: Music tab and Activity bell** (SPEC-music-player §4). `nav.ts` tabs become Home · Media · Search/Discover · Music · Library; Activity leaves the dock/rail and becomes a bell with its count in the phone top card (left of Settings) and at the right end of the desktop header card, on every page; old `#/notifications` links still land. Phone and desktop. | 1 | S |
| 6 | **Music tab v1, layout B** (§13). The page with the 250 px crates column (desktop) or sheet (phone): LIBRARIES shows "This PC" with count and indexing state; PLAYLISTS and SMART LISTS sections exist but stay empty until PR 18. Content: Albums (a folder = an album) / Artists / Tracks, with tempo shown small and muted on rows. Playing a track or "Play all" fills the server queue (PR 4). | 4, 5 | M |
| 7 | **Player layer, player bar and audio engine.** The full-screen player layer over the app (open from any play, from the bar; Esc, collapse button, swipe down to close); the player bar on every page (desktop floating at the bottom of the content, phone pill above the dock); the audio graph and blend rules of SPEC-music-player §9 (two elements, gains, analyser, equal-power blends, preload); title, artist with BPM and beat dot, seek, transport; queue sheet with rows, balance meters (Reef palette) and the equaliser glyph. The light (§5.2) as a placeholder background. | 4 | M |
| 8 | **The timeline (flow) renderer.** Canvas layers exactly as SPEC-music-player §6: one continuous spline per band across the queue, **fixed-grid sampling** (16th notes from the first downbeat, continuous window, thinning), fisheye and life-size mappings, bass below the horizon with 3.5 px blur, mids veil, highs and edge line, glow layer, minute grid, beat ticks, blend labels and thinning, playhead and live dot, per-track highlight regions, Reef palette. **Tests:** sampling has no frame-to-frame jump over 2 % of the curve height in a 60 fps simulation (port the measurement from this spec's work); performance budget on a mid phone (**Ask** if over 8 ms per frame). | 3, 7 | L |
| 9 | **Spectral background.** SPEC-music-player's background section: analyser bands with per-band auto-gain, attack and release as time constants, loudness weight, colour picked along the **Abyss** palette by intensity, fixed size, **Rollers** values, the dark **halo** (3 px) cut by the timeline, clipped with the stage in expanded mode (clip on a wrapper, not on the zoomed canvas). The Look tuning panel only on `#/lab/music`. | 8 | M |
| 10 | **Interactions.** Scrub only within the timeline band (grab, inertia, tap to jump, glide); title and timeline clicks glide; the highlight animates in and out and flashes every track crossed; drag to reorder from anywhere on a row except buttons (mouse threshold, touch long-press); add and remove animations (gap opens then the row slides in; the row slides out then the gap closes); reorder FLIP in 420 ms; "+ Add" panel with fitted, animated height (never on TV). All numbers from SPEC-music-player. | 8 | M |
| 11 | **Two modes and the One-motion switch** (SPEC-music-player §7–8): default and expanded on desktop and phone, the persisted pin, the 620 ms switch with the flow morph, interruptible mid-motion, reduced motion. | 8, 10 | M |
| 12 | **Beat-synced mixing.** The per-transition plan (4 s fade or sync of n bars from a 4-bar phrase, tempo match within ±8 %, glide back, bass swap, nudge), the phase lock, the transition popover from the label's second line with Hear it and live status, the default-mix option, per-pair settings saved in the server queue (PR 4). **Then remove the `lab` flag** from the Music tab and the player. Tests: plan() cases (fade fallback 172→150, 8-bar sync start on a phrase), PLL convergence in a simulation. | 4, 8 | M |

### Phase 3: the TV (station)

| # | PR | Needs | Size |
|---|---|---|---|
| 13 | **Station spike (Ask before building 14).** The TV picture is the desktop immersive view at 1920 × 1080 with controls removed (`?tv`). Measure on the Windows machine: (a) a headless Chromium rendering the real `?tv` page, captured to ffmpeg, against (b) a Python port of the renderers. Measure CPU, frame pacing and A/V sync over 30 min. Write the numbers and a recommendation into §7. This replaces the "same renderer in Python" assumption of §5 and §9 if (a) wins. | 8, 9 | S |
| 14 | **Station.** One continuous stream through the TV routes (`_live_piped`, `tv_run_from`): server-side audio mix with the same plan as the browser (fades, beat sync, bass swap), the picture from the chosen renderer, timestamps continuous across tracks; skip, add, remove and reorder applied live with the app's motion. Boundary checks in tests (no gap, no click at transitions: ffmpeg silence and level detection). | 4, 12, 13 | L |
| 15 | **Cast integration.** Send to TV from the player; while casting the sound is on the TV only; volume strip (mute, 0–100, wheel and ↑/↓ step 5) driving the Cast session volume; the TV's 1.6 s volume pill; cast metadata (title, artist, cover); now-casting bar for music; pull back. Chromecast and DLNA. | 14 | M |

### Phase 4: online sources

| # | PR | Needs | Size |
|---|---|---|---|
| 16 | **YouTube and YouTube Music as music.** An "Audio only" download choice (`-f ba`, keep the container yt-dlp picks); a YouTube video plays as music (audio only, the picture is dropped); a YouTube Music playlist as a queue source. Streamed tracks get their analysis on first fetch (§13.3). | 3, 7 | M |
| 17 | **One music search across sources** (§13.4): libraries plus online sources through the existing source-picker search, with chips to search one source (Everywhere · Your libraries · YouTube Music · YouTube · SoundCloud · Bandcamp · +); top match; in-library and online sections; play now, queue, or save into a chosen library. **Ask:** which online sources at launch (SoundCloud and Bandcamp need extractors). | 6, 16 | M |

### Phase 5: libraries, playlists and DJ sets (SPEC-music §13)

| # | PR | Needs | Size |
|---|---|---|---|
| 18 | **Playlists as a tree.** Folders, playlists, cross-source items, parts (a set is a playlist with parts), smart lists (rules: genre, tempo range, added date, never played). The crates column fills in. | 6 | M |
| 19 | **Several libraries.** More folders on this machine; a NAS path; a **remote sestudio server** as a library (its API federated: browse, stream, analysis); a YouTube Music account (likes). Status dot, counts, indexing and offline states; "Add a library". **Ask:** auth between sestudio servers. | 6 | L |
| 20 | **Analysis v2 (offline).** Key (Camelot), genre with a confidence (doubtful ones dashed with a %, one click to confirm or fix), energy curve, and **structure**: intro, buildup, drop, breakdown and outro with their start bars. The mix uses structure: mix out of an outro into an intro, never over a drop. **Ask:** model choice and its size on the Android build. Starts with a research note comparing approaches on the test music. | 3 | L |
| 21 | **Set builder.** The set page: tempo and energy curve over the parts, the transition shown between each pair (synced, fade, warnings with a suggested fix), key and genre on rows, auto-order (smooth tempo, harmonic, energy arc; within a part unless asked), "Fill from library" (genre, tempo range, length; any library, online included). | 12, 18, 20 | M |

**Order and parallel work:** 0 → 1 → 2 → (3, 4) → 5 → 6, 7 → 8 → (9, 10, 12) → 11. The TV track
(13 → 14 → 15) can start once 8 and 9 exist. Phases 4 and 5 follow, mostly in parallel with each other.

## 12. Files this touches (starting points)

Server: `src/sestudio/downloaded.py` (suffixes, mime, tags, track ids), `src/sestudio/library.py` (SQLite:
analysis and queue tables), `src/sestudio/web/routes/downloaded.py` (`_live_piped`, `tv_run_from`),
`src/sestudio/web/routes/cast.py` (live stream, metadata, volume), `src/sestudio/web/routes/search.py`
(source picker), `src/sestudio/sites/creators.py` and `src/sestudio/downloader.py` (audio-only `-f ba`),
new `src/sestudio/music/` (analysis, queue, mix plan, station).

Browser: `frontend/src/nav.ts` and `frontend/src/components/AppShell.tsx` (tabs, bell),
`frontend/src/components/PageHeader.tsx` (bell in the header card), new `frontend/src/views/MusicView.tsx`,
new `frontend/src/components/music/` (Layer, PlayerBar, Flow, Background, Queue, AddPanel, MixPopover,
Crates), `frontend/src/cast.ts` (metadata and volume only), `frontend/src/playlistCollapsed.ts` (pattern
for the persisted pin), new `frontend/src/lab/`.

## 13. Ready for later: libraries, sources, sets (decided 2026-11-03, not built yet)

Reference: `docs/assets/music-future-mockups.html` (layout **B** picked: the side column). None of this
is in the 9-PR plan; the point is that the first PRs leave room for it instead of having to be undone.

1. **Where a track lives.** Every track and album carries its **library** (this PC folder, NAS, a remote
   sestudio server, a YouTube Music account…) and its **source** (file, YouTube Music, YouTube,
   SoundCloud, Bandcamp). That is the default entry point: browsing, badges, filters and "Save to…" read
   it. **Playlists are cross-source**: one playlist can mix tracks from any library and any source.
2. **Playlists are a tree.** Folders hold playlists; a playlist can be split into **parts**
   (sub-playlists). A **set** is a playlist with parts (Warm-up / Peak / Cool down), with the transition
   between each pair of tracks shown and editable. Smart lists (rules: genre, tempo range, "new this
   week"…) sit next to them.
3. **Offline analysis**, run once per track on the server (local files at indexing; streamed tracks the
   first time they are fetched), never in the browser: tempo, beat grid and first downbeat (as the
   prototype's `prep_bpm.py`), **key** (Camelot), **genre with a confidence** (doubtful ones shown dashed
   with a %, one click to confirm or fix), **energy** curve, and **structure**: intro, buildup, drop,
   breakdown, outro, with their start bars. Structure feeds the mix (mix out of an outro into an intro,
   never over a drop) and the set's energy curve.
4. **One search across sources** (libraries + online), reusing the video search's source picker, with
   **sub-search on one source** (chips: Everywhere · Your libraries · YouTube Music · YouTube ·
   SoundCloud · Bandcamp · +). A YouTube video plays as music (audio only). Anything online can be played
   now, queued, or saved into a chosen library.

**Layout B, in short:** the Music page has a 250 px column (desktop) with LIBRARIES (status dot, count,
indexing / offline state, "Add a library"), PLAYLISTS (folders, sets with their part count) and SMART
LISTS; the content area shows Albums / Artists / Tracks with genre filters. On the phone the column is a
sheet opened from an "All libraries" pill in the top card.

**What the first PRs must do so this fits later:** give library entries a `library` and a `source`
field (one library and source `file` to start); store the queue as references to tracks
(library + id), never as file paths; keep analysis results in their own table keyed by track, with
room for more fields; and route music search through the existing source-picker search.
