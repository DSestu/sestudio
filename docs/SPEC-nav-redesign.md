# Spec: navigation redesign (phone dock, top bar, desktop rail)

> Agreed through mockups, 2026-11-01. Mockups were built on the live app's look and posters.
> Step 0 (Downloaded + Downloads merged into **Media**) shipped in #179.

## 1. Why

On a phone, playing while casting stacks three bars at the bottom (mini player, casting bar,
tab bar): 166px of fixed chrome, a fifth of the screen. The active tab is a 2px line, labels sit
at 50% opacity, and the top bar spends a full row on the wordmark while every page spends
another on its own title. Phone and desktop look like two different apps.

## 2. Goals

1. **One object for navigation and playback** on the phone: the player lives inside the dock.
2. **More room for posters:** both bars leave while scrolling down, and come back together.
3. **The header says where you are:** page name, a status line, the page's tabs and actions.
4. **Phone and desktop share one material and one set of shapes** (glass, pill, Search button).
5. **Motion that explains state**, fast, interruptible, and a 120 ms fade under reduced motion.

### Non-goals

- Changing page content (Library lists, Media listing, search results, watch page).
- New features in the bars (no new global cast picker, no account menu).

## 3. Material: Signal glass

One `.glass` utility used by every bar, sheet, popover and dock.

| Property | Value |
|---|---|
| Background | `hsla(205 62% 14% / .62)` |
| Backdrop | `blur(24px) saturate(1.6)` |
| Edge light | 1px gradient border, white at .24 top-left fading to .03, .11 bottom-right |
| Top highlight | `inset 0 1px 0 rgba(255,255,255,.12)` |
| Shadow | `0 16px 40px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.35)` |
| Grain | SVG fractal noise, overlay, .03 |
| Radius | 28px (dock, sheet); full pill for single-row bars; 22–24px desktop |

Active state everywhere: a pill `rgba(25,180,240,.22)` behind the icon or label, sliding
between items. Fallback: where `backdrop-filter` is unsupported, or if the Android app stutters,
the same tint at opacity .92 with no blur.

## 4. Phone

### 4.1 Dock (bottom)

Floating glass dock, 12px from the screen edges plus the bottom safe area.

- Items: **Home · Library · Search · Media · Activity**. Search is a filled 52px signal-blue
  circle in the middle; the others are icon + label, active one with the sliding pill.
- Search opens today's Discover sheet (search box, TMDB, creators, sources), which grows out of
  the button and turns it into the close button. Discover leaves the bar.
- Badges sit on the icon's top-right corner (Media: active downloads; Activity: unread).
- **Playback:** when something plays, a player row opens inside the dock above the tabs
  (thumbnail, title, cast chip such as "Salon TV" when casting, play/pause, close, progress line).
  Replaces the separate mini-player strip and Now-Casting bar on phones.
- The library selection bar still takes the dock's place while selecting (as today).

### 4.2 Top bar: two-tier card (option B)

Glass card at the top, 12px from the edges plus the top safe area.

- **Row 1:** page name (20px, 680 weight), a status line under it (12px, the count in signal
  blue), a ⋯ button with the page's actions, then Settings as its own button.
- **Row 2 (only on pages with tabs):** the tabs as a segmented control with the sliding pill.
- The page's own title row and tab row go away; the card replaces both.

| Page | Row 1 | Status line | ⋯ holds | Row 2 |
|---|---|---|---|---|
| Home | wordmark | "2 new for you" | — | — |
| Library | Library | "44 in progress" (follows the tab) | sort, layout, select | Watching · Watchlist · Favourites |
| Media | Media | "1121 titles on disk · 1 downloading" | Collection toolbar options | Collection · Queue |
| Activity | Activity | "2 new" | Unread only, Mark all read | — |
| Settings | ← back + Settings | — | — | — |
| Creators / Channel / Person | back + name | follower or video count | page actions | the page's tabs if any |
| Search results | keeps its own search header (§11 of the search spec) | | | |

Narrow phones: if Row 1 overflows, the status line truncates first; the ⋯ button never hides.

### 4.3 Hide on scroll

- Scrolling down more than 6px (past the first 40px) sends the top card up and the dock down
  together; any scroll up brings both back.
- If something is playing, a glass **player pill** (round thumbnail, title, play/pause, progress
  ring) stays at the bottom centre; tapping it brings the dock back.
- Never hides while a sheet, popover or the selection bar is open, or on the watch page.

## 5. Desktop (D2)

- **Slim glass rail**, 84px wide, floating 12px from the edges: mark, the same filled Search
  button (focuses the search bar, Ctrl K still works), Home · Discover · Library · Media ·
  Activity as icon + label with a vertical sliding pill, Settings at the bottom.
- **Discover flyout:** hovering or focusing Discover opens a glass panel beside the rail with
  TMDB, the video sources and creators (today's rail list), wiping out of the rail.
- **Player dock:** the desktop mini-player card and the Now-Casting bar become one floating
  glass dock at the bottom of the page (video thumbnail, title, cast chip, previous / play /
  next, close, progress). Same object as the phone's player row.
- **Header card with search inside (option 3):** the phone's two-tier glass card, floating 12px
  from the rail and the window edges. Row 1: page name + status line, then the **search field
  filling the space up to the ⋯ button** (24px gaps, at least 480px, at most 860px; Ctrl K hint
  inside), then ⋯. Row 2: the page's tabs. On the search results page the title is the query.
- The card hides on scroll down and comes back on scroll up, like the phone. Ctrl K or the rail's
  Search button bring it back with the cursor in the field.

## 6. Motion

| Moment | Motion | Duration / easing |
|---|---|---|
| Change tab (phone, desktop, segmented) | pill slides to the new item | 300 ms, `ease-smooth` |
| Playback starts | dock grows upward, player row sharpens in (blur 6px → 0) | 420 ms |
| Scroll down / up | top card up + dock down, together | 220 ms out (ease-in), 340 ms back |
| Player pill | rises in after the dock leaves | 300 ms, 90 ms delay |
| Search sheet | clip-path grows from the Search button; button becomes close | 480 ms open, 300 ms close |
| ⋯ popover | scales from its button, 0.92 → 1 | 220 ms |
| Desktop Discover flyout | clip-path wipe out of the rail | 320 ms open, 200 ms close |
| Desktop player dock | rises in | 420 ms |
| Button press | scale 0.92 | 120 ms |

All motion uses the app's one easing, `ease-smooth` (`index.css`), unless marked ease-in.
Reduced motion: no movement; every change is a 120 ms fade.

## 7. Build plan (PRs)

1. **Glass utility** — `.glass` + tokens in CSS, no-blur fallback. No visible change yet.
2. **Phone dock** — replaces the bottom tab bar: 5 items, Search opens the Discover sheet
   (with its grow animation), sliding pill, badges.
3. **Player in the dock (phone)** — mini player and casting bar move into the dock as one row.
4. **Phone top card** — header slot each page fills (title, status, ⋯, tabs); Home, Library,
   Media, Settings first.
5. **Top card on the other pages** — Activity, Creators, Channel, Person.
6. **Hide on scroll + player pill (phone).**
7. **Desktop slim rail + Discover flyout.**
8. **Desktop header card** — search moves into the page's glass card, hides on scroll.
9. **Desktop player dock.**

About 3–3.5 days in all. Each PR ships on its own and is testable in the live app.

## 8. Decided after the first draft

- Desktop search bar and page headers: option 3 (2026-11-01). One glass card holds both and
  hides on scroll; the search field is as wide as the row allows (§5).
