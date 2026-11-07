# Spec: everything below the player on the watch page

> Agreed through an interactive prototype on 2026-11-07. The reference is
> [`docs/proto/watch/below-player.html`](proto/watch/below-player.html): run
> `node docs/proto/watch/serve.js 5390` and open `http://localhost:5390/`, direction **A**
> with its defaults (compact, Playback as an inline row, About split, 8 cast, poster shelf,
> phone tabs Episodes · About · Sources). Use its Desktop / Phone, Series / Film / Local file
> and Playing / Not started / On TV / Failed switches. Where this text and the prototype
> disagree, this text wins.
>
> Out of scope: the player itself, the page header, and the desktop playlist rail / sheet / pin
> (docs/SPEC-watch-page.md, C). They stay as they are.

## 1. Why

- **Below the player is a pile of controls.** On desktop the now-playing line is followed by a
  toolbar (Send to TV, Pop out, Quality, Frame rate, Audio, Autoplay), an "Advanced AI settings"
  fold, a "Performance" fold and, when opened, the sources panel. The things you use every
  evening (Send to TV, switch version) sit among things you touch once a month.
- **About is an afterthought.** TMDB's backdrop band, synopsis, a scrolling row of 56px cast
  faces and the similar titles are stacked at the bottom with no layout of their own.
- **The phone splits jobs oddly.** Its tabs are Episodes / Sources / Output: the picture
  settings get a whole tab, while About has none and sits under the tabs.

## 2. User stories (ranked)

| # | Story | Where it lands |
|---|---|---|
| S1 | Send what's playing to the TV, phone in hand on the couch | **Send to TV** on the line, every breakpoint |
| S2 | It won't play, or it's the wrong language: switch version, site or host | Version pill → Sources; failure opens it by itself |
| S3 | See what comes next / pick another episode | Desktop rail (unchanged); phone Episodes tab |
| S4 | "Who's that actor?" | About: 8 cast with roles |
| S5 | Done with it, pick something similar | "More like <title>" poster shelf |
| S6 | Fix the picture: quality, frame rate, AI frames (rare) | **Playback**, folded away |

## 3. What was decided

| Topic | Decision |
|---|---|
| The line (desktop) | One row under the player: **episode title** (`E02 · Cat's in the Bag…`; a film's or video's own title), the **version pill** (`VOSTFR` filled, then `KissKH · vidzy`, then a chevron), a spacer, then **Send to TV** (outline), **Pop out** (icon only, same Chromium-only rule as today), **Playback** (sliders icon + label), and for a film / video only, **Download** (primary). On TV, Send to TV becomes **Bring it back here**. |
| Playback (desktop) | The Playback button toggles a **row that folds open under the line** (not a popover, not over the video). The row holds, left to right: Quality, Frame rate, AI frames (the select that today hides in "Advanced AI settings", now shown directly), Audio (only when the file on disk has several tracks, as today), Autoplay next, and at the end the smoothness readout (`● Smooth · 23.9 fps shown · 0 dropped`) with **Details**, which opens today's `BrowserPerformance` content. The readout comes from the video's own frame counts (`getVideoPlaybackQuality`), sampled every second. Closed by default; remembers open/closed in localStorage. The separate "Performance" fold goes away. |
| Sources (desktop) | The version pill opens the sources as a **glass popover anchored under the pill** (today's `SourcesPanel` content, unchanged inside). Esc, a click outside, or picking a host closes it. The in-place panel under the line goes away. |
| Failure | When a host fails, a banner appears under the line: spinner, "`vidzy` didn't answer. Trying `KissKH · filmoon`…" while the next host is probed, then "No other host did either." once none is left, and **Pick one**, which opens the Sources popover (desktop) or the Sources tab (phone). Today's auto-open of the sources on failure becomes this banner plus auto-open. |
| On TV | A banner under the line: TV icon, "On **Salon · LG** · VOSTFR", **Bring back**. The device name is the TV picked in `OutputSwitcher` (Chromecast: the receiver's own name). While this episode is on the TV, Send to TV reads **Bring it back here**. Both pull back the way the Now Casting bar's "Watch here" does (`pullBackEpisode`). |
| About (desktop) | After a hairline: a **split** block. Left: rating pill, votes · year, genre chips, the synopsis (15px, max 66ch), "Created by / Directed by <name> · ▶ Trailer". Right (400px): the first **8 cast** in a 2-column grid, 40px faces, name over role. Then **More like <title>**: 7 posters in one row with their rating badges. Replaces `TitleHeader` (only `WatchView` uses it, so it is rewritten in place). Renders nothing without TMDB data, as today. |
| Films' right column | The "Similar titles" right column for films is **removed**: the shelf under About replaces it and the player gets the full width. A YouTube / Twitch video keeps its **More from <channel>** column (it has no TMDB About). This was not shown in the prototype; if the user wants the film column back, keep `SimilarTitles` in the aside and drop the shelf for films only. |
| Local file (no TMDB match) | The line, then one row: the file path in mono (truncated), its size, "Downloaded". No About, no shelf, no tabs. Same as today's `diskFile` row, moved under the line. |
| Phone: line and actions | Row 1: the episode title (truncated) and the version pill (language only + chevron). Row 2: **Send to TV** (outline, stretches), Pop out (icon), Playback (icon); a film or video adds a **Download** icon button at the end. Tapping the version pill selects the **Sources** tab and scrolls it into view (no separate sheet: one place for sources). |
| Phone: Playback | The Playback icon opens a **bottom sheet** (glass, grab handle, scrim; tap scrim or ✕ to close) with the same fields as the desktop row, stacked. The **Output tab is removed**. |
| Phone: tabs | Series: **Episodes · About · Sources**. Film / video: **About · Sources**. Local file with no TMDB match: no tabs. About tab: backdrop band (120px), rating line, synopsis, credits, the cast as a scrolling row of 54px faces, "More like <title>" as a 3-column poster grid (6). The Episodes tab keeps today's bounded, self-scrolling list and download bar. On failure the Sources tab is selected, as today. |
| Missing version | When a language has no listing for this episode (the one chosen, or any the title has elsewhere), the Sources list shows a dashed card: "No site has **VF** for S1 · E02", a line on where it does exist if known (other episodes of the season, else the sites listing it), **Tell me when VF lands**, and "Keep watching in VOSTFR" (puts the card away for this episode). The button creates a `title_lang` watcher (`film_available` for a film) with `config.langs = [lang]`, or adds the language to the page's existing watcher (the backend already supports a language list, see `src/sestudio/watchers/models.py`); afterwards it reads "✓ Watching for VF". |
| Density | Compact: 10px between groups under the player, 10px panel padding. |
| Visual language | Existing tokens only: Signal glass for the popover and sheet, `primary/22` for selected rows, the `Segmented` control for tabs, rating pills as on the rest of the app. No new colours or fonts. |

## 4. PR plan

Each PR is small, ships on its own, and leaves the page working. Rebuild `frontend/dist` in
each (`npm run build` in `frontend/`).

1. **The line and the Playback row (desktop).** New `components/watch/NowPlayingLine.tsx`
   (title, version pill, Send to TV, Pop out, Playback toggle, Download) and
   `PlaybackRow.tsx` (quality, frame rate, AI frames lifted out of `BrowserFrameRate`'s
   `<details>`, audio, autoplay, smoothness readout + Details → `BrowserPerformance`).
   `OutputSwitcher` keeps owning casting; render its trigger as the line's Send to TV and
   drop its toolbar children. Remove the old toolbar and the Performance fold. Desktop only;
   the phone keeps its current layout in this PR.
2. **Sources popover + failure banner (desktop).** The version pill opens `SourcesPanel` in a
   glass popover; close on Esc / outside / pick. Replace the in-place panel. Add the failure
   banner and the On-TV banner (both breakpoints, they are one component).
3. **About section.** Rewrite `components/season/TitleHeader.tsx` as the split About block
   (8-cast grid, credits, trailer) plus the "More like <title>" shelf. Remove the films'
   Similar right column (`isSingle && side === 'similar'`); keep the video channel column.
   Phone keeps rendering it below the tabs until PR 4.
4. **Phone.** Line + action row, Playback bottom sheet, tabs Episodes · About · Sources (film:
   About · Sources; local file: none), version pill → Sources tab, About moves into its tab,
   Output tab removed. Check the docked-player maths (`--dock-clear`, the Episodes tab height)
   still hold.
5. **Missing-version card.** In `SourcesPanel`, when `activeLang` has no listing for the
   episode, show the dashed card with **Tell me when <lang> lands** → `createWatcher`
   (`kind: 'title_lang'`, `config.langs: [lang]`), and the "Watching" state when a matching
   watcher exists.

## 5. Verify

- Desktop 1440 and phone 390 against the prototype, for a series, a film, a YouTube video
  and a local file, in the playing, not started, casting and failed states.
- Casting still hands off at the current position and Bring back still pulls back.
- A failed stream still lands you on the sources with one click or none.
- The TV station (`/?tv`) is untouched.

## 6. Left for later

- Host health history ("slow last time", "failed 2 h ago"): the prototype shows it, but the
  server only knows the current probe status. Show only what `hostStatus` has today.
- Per-episode TMDB data (titles, synopses, stills): the prototype uses English episode titles;
  the app shows what the site gives.
