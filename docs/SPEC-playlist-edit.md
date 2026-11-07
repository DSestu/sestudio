# Playlist edit mode

Status: design approved 2026-11-07. Mockups: `.impeccable/mocks/playlist-edit/index.html` (scenes) and
`proto.html` (the interactive prototype the three open questions were decided in, picks A · A · A).

## Stories

1. Build tonight's set from my own folders without leaving the playlist.
2. "This track looks good, where would it go?"
3. "This join clashes, what could go between?"
4. Find a track I don't own online, analyse it, then judge it like my own files.
5. Drag anything anywhere and see whether the drop is good before letting go.

## Decisions

| Question | Decision |
|---|---|
| Entry | A toggle on a playlist page: **Edit** opens the editor, **Done** closes it (`?edit=1` in the URL, so Back leaves it). Same on phones. Smart lists have no edit mode |
| Layout, wide screens (64rem and up, where Fits already docks today) | Three columns: **Add from** (Library / Online) · the playlist · **Fits**. The libraries and playlists sidebar is hidden while editing |
| Layout, phones and narrow windows | The playlist fills the page; a strip of three buttons (Library · Online · Fits) under the header opens each as a sheet |
| When Fits changes | It follows what the pointer rests on for **250 ms** and stays on it after the pointer leaves. Moving into the Fits column never changes it. **Pin** freezes it. On phones it follows the last tap |
| Unanalysed online tracks | They drop in at once. Their row shows **Not analysed** and an **Analyse** button; the joins around them stay grey until the analysis lands |

## What Fits shows

| The target | Fits shows |
|---|---|
| Nothing yet | What fits after the last track (today's panel) |
| A playlist row | What fits after it |
| A join | What fits between its two tracks (today's "Fits between", with its clash fixes) |
| A track in Add from (library or online) | **Where it fits**: the 3 best gaps in the playlist, each with its in and out joins and a **Put here** button; the gaps show as numbered pins in the playlist |
| An online track not analysed | Its **Analyse** button and what dropping it now does |
| A drag in progress, over the playlist | **Drop preview**: the gap's in and out joins, the clash count before → after and the new length |

Gap ranking: for each gap, the cost of the join in plus the join out (`proximity.cost`), a bonus when it replaces a clash
with two safe joins, and the energy step against the neighbours. The playlist's own copy of the track is never a gap.

## Add from

- **Library:** a folder browser. Root: each library (count), then the other playlists. Inside a library: its folders,
  then its tracks. Breadcrumbs go back up; the filter field filters the folder (at the root it searches every library).
  Track rows: title, artist, key, BPM, duration, "In playlist" when it already is. Hover shows **Add** (last).
- **Online:** one search field and a source rail: Your libraries, YouTube Music, SoundCloud, YouTube (one source shown at a time).
  Rows: artwork, title, artist, duration, then the analysis (key, BPM) or **Analyse**, or the analysis in progress
  (tempo, then key). An analysed online track ranks in Fits like the library's.
- Every row drags into the playlist (desktop), Fits rows too. A drag over the playlist opens a gap where it would land.

## Server

`POST /api/music/tracks/{id}/analyse` starts the background analysis of an online track (the same one a queued online
track gets, `online.kick_analysis`). 400 for a track that is not online, 409 when music analysis is off. Progress is
read from `GET /api/music/tracks/analysis?ids=` (`partial`, `progress`, then `bpm`) and the summary when done.
Adding an online track to a playlist does not analyse it (decision 3 above); the queue still does on add.

## Not in this round

- Hold-to-lift drag on phones: phones add with the row's **+**, **Put here** and Fits' **+**. HTML drag and drop does not work on touch.
- "Added this week" and "Not analysed yet" shortcuts in the library root (the library has no added date yet).

## Plan

1. Server: the analyse endpoint, with a test.
2. Edit focus store (target, 250 ms follow, pin, drag) and the Edit / Done toggle with the three-column layout.
3. Add from: Library folder browser.
4. Add from: Online search with Analyse.
5. Playlist drop targets for outside tracks with the gap line, Fits rows draggable, Where it fits and Drop preview in Fits.
6. Phone: the Library · Online · Fits strip and sheets.
