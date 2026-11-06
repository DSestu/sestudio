# Harmony navigation

Status: brief confirmed 2026-11-05; layout A (side panel on desktop, half-height sheet on phone) picked from `.impeccable/mocks/harmony-nav/index.html`. Source: Impeccable critique of the harmony features
(22/40, `.impeccable/critique/`), which found 8+ entry points to "what plays well next" under 5 names.

## Decisions

| Question | Decision |
|---|---|
| Main moment | While listening and building ahead matter equally |
| Mix builder vs playlist editor | One playlist workspace, one mix at a time. Mix builder, parallel flows and branches are removed |
| Explore | A Map view inside the playlist, not a Music tab |
| Object name | **Playlist** everywhere; "set" and "mix" leave the UI |
| Fits from a track | A panel (desktop) / sheet (phone) anchored to the track; the Tracks tab loses its Fits after mode |
| Detail level | Follows the theory level setting (plain / tap / theory) |
| Fits next layout in a playlist | A: docked side panel on desktop, half-height sheet on phone (not an inline tray) |

## Structure

**One component, `FitsNext`:** ranked list, a reason per row, filter row, empty state with loosen buttons.
It appears in exactly three places:

| Where | Anchored to | Replaces |
|---|---|---|
| Playlist workspace: side panel (desktop), bottom sheet (phone) | Selected track, or selected join ("fits between") | Inspector Fits next tab, Mix builder Best next + picker, Fill a gap, Bridge two tracks |
| Player: Add to queue, Fits next tab | Last queued track (else the playing one) | Current Crate FitsTab; Autopilot moves here as "Keep filling like this" |
| Any track: row menu, key card, map dot, "Fits next" | That track | Tracks tab Fits after mode and its 5-filter bar |

**Playlist workspace (`PlaylistView`):**
- List | Map toggle. Map = today's Explore with this playlist's path, fitting tracks faint.
- Header: name, count and time, 3-lane curve, "Clashes (n)" stepping through each clash's Fix.
- Shape menu: Auto-order (Harmonic path / Smooth tempo / Energy arc), Draw the arcs.
- A new playlist is not saved until it has a track. Empty state offers Start from a track / Draw the arcs / Empty (replaces the Build a set dialog).
- Inspector tabs Notes and Vibe go: Notes is in the key card, Vibe becomes Map.

**Music:** tabs Albums, Artists, Tracks. Header "+ New playlist". Sidebar: Libraries, Playlists, Smart lists (no Mixes).
"? Harmony basics" moves to the Fits next panel help and Settings.

## Theory level

- Plain: mood word + plain reason ("smooth · lifts"); filters Smooth/Anything and Energy.
- Tap: plain, tap a reason for notes and keyboard.
- Theory: key names, "6 of 7 notes", all 5 filters (Harmony, Mood, Energy, Genre, Tempo).

## States

FitsNext: nothing analysed, anchor still analysing, nothing fits (loosen), fits between.
Playlist: new/empty, 1 track, ~70 tracks, with parts. Player: empty queue anchors to the playing track, else "pick a track".

## Scope

In: routes, sidebar, MusicView tabs/header, PlaylistView, Crate Fits next, row menu, key card and dot card actions;
remove MixBuilder, BuildSet dialog, Explore tab, `#/mixes`.
Untouched: player timeline and look, harmony engine and API, smart lists (no panel), key card and Harmony basics content.
Anti-goals: a second place to build a playlist; a fits list with its own filters or words; a new top-level tab.

## Constraints

- Phone first: sheets with a half-height stop, visible close, back gesture; one responsive dialog component everywhere.
- Migration: the live server's non-empty Mix builder flows convert to playlists once; empty ones are dropped. Confirm before it runs on the live server.
