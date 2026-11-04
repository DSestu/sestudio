# Spec: the Settings page (categories and subpages)

> Agreed through mockups, 2026-11-04. The approved mockup is
> [`docs/assets/settings-mockup.html`](assets/settings-mockup.html): open it in a browser. It
> is the visual reference for every PR below. Where this text and the mockup disagree, this
> text wins.

## 1. Why

- **It predates the redesigns.** Home, the nav, Search and Watch moved to the glass identity;
  Settings is still the first version: uppercase labels, dividers, a stack of full-width selects.
- **Too long to find anything.** 12 sections in one scroll: 5,400px on desktop, 6,250px on a
  phone. The QR codes for sharing come first; the language setting is three screens down.
- **It mixes everyday choices with server admin.** Language and subtitles sit beside the server
  log, restart, share tokens and a Danger zone.
- **Help text is paragraphs.** "Download order" alone explains itself in five sentences.
- **One 1,200-line file** (`frontend/src/views/SettingsView.tsx`).

## 2. What was decided

| Topic | Decision |
|---|---|
| Structure | 8 categories in 3 groups. **Watching:** Playback, Subtitles. **Finding & keeping:** Sources & search, Downloads, Music, Notifications. **This server:** Server, Share sestudio. |
| Phone (< `md`) | `#/settings` is the **home list**: grouped rows (icon tile, name, a one-line summary of the current values, chevron). A row opens the category as its own page (`#/settings?s=<id>`), with back and the category name in the top card and "Settings" as its status line. |
| Desktop (≥ `md`) | Two columns under the top card: the **category list** (236px, grouped like the phone list, active item in the app's active pill) and the **category page** (max 40rem). `#/settings` without `s` shows Playback. Picking a category replaces the URL's `s` (`replaceParams`), so Back leaves Settings instead of walking through categories. |
| Summaries | Each home-list row shows the current state, e.g. "VF · Source quality · AI frames on", "Server · R:\Video\films-series", "● Running · 2 h 5 min". Desktop's list shows no summaries. |
| Attention | Problems float to the top of the phone home list as an amber row that opens the category; on desktop the category gets an amber dot. Today's problems: no JS runtime (Server), no TMDB key (Sources & search), AI setup failed (Playback). |
| Rows | Settings live in grouped lists: `bg-base-200`, 14px radius, rows ≥ 56px with a 1px base-300 separator; group titles in 12px semibold at 50%, sentence case (no more uppercase). Label left, control right; help is **one line** under the label. A group may carry a footnote under it for anything longer. |
| Controls | Choices of 2–3 short values (language, download destination) become a segmented radio group (`Choice` in `views/settings/rows.tsx`; `PageHeader`'s `Segmented` is a tablist, wrong for a value). Longer lists stay native `<select>`s, shown as the current value + chevron. Toggles stay daisyUI `toggle-primary`. Sliders show their value in tabular numbers. |
| Danger zone | Removed. "Allow deleting files" moves to Downloads; Nightly and Restart move to Server. They keep the red toggle / outline and their confirms. |
| Copy | Each setting keeps its meaning but gets one line of help (see the mockup for the approved wording of Playback, Subtitles and Downloads). Long explanations that still matter (the CallMeBot steps, the Discogs model licence) stay, as the group's footnote. |
| Out of scope | A search box for settings; any new setting; any change to what a setting does; the YouTube & Twitch page (Settings only links to it). |

### Where each setting goes

| Category | Holds (from today's sections) |
|---|---|
| Playback | Preferred language, video quality, play on open; AI frame rates: on/off, anime held drawings, engine status (GPU, engine, runtime, speed), setup progress, Set up now / Reinstall |
| Subtitles | The preview (sticky at the top while scrolling), font, size, PiP size, background, blur, outline, Reset to defaults |
| Sources & search | Sites on/off with their links, preferred source, one card per show, TMDB API key, a row linking to the YouTube & Twitch page |
| Downloads | Download to, folder (server), try-first order (sites, hosts, Reset), allow deleting files |
| Music | Libraries (+ Add a library), genre model, YouTube Music cookies file, share tokens |
| Notifications | Message me on WhatsApp, number, CallMeBot key |
| Server | Status and uptime, the JS runtime warning, the log (Copy, Restart, Stop in the Android app), Restart server with its command, Nightly (Android app only) |
| Share sestudio | The Android app and Google Colab QR codes, links, Share… / Copy link |

## 3. Building blocks that already exist (reuse them)

| Need | Where |
|---|---|
| Top card with back, title, status | `PageHeader` (`frontend/src/components/PageHeader.tsx`) |
| Rows, groups, toggles, choices | `views/settings/rows.tsx` (PR 2) |
| Route params | `route.params`, `replaceParams`, `navigate` in `frontend/src/nav.ts` |
| Back | `goBack` in `frontend/src/pageHeader.ts` |
| Rank chips | `RankRow` (`frontend/src/components/RankRow.tsx`) |
| AI setup | `useAiSetup`, `AiSetupProgress`, `AiHeldFrames` |
| Music libraries | `LibrariesSettings`, `AddLibrary` |
| Restart | `useRestart` (today inside `SettingsView.tsx`; moves with Server) |

## 4. Traps (read before touching anything)

- **Write-only keys.** The TMDB and CallMeBot keys are never sent back; the fields are never
  pre-filled. Only `tmdb_configured` / `callmebot_configured` say one is stored.
- **Not everything is `AppSettings`.** Video quality (`playerPrefs` + `setBrowserQuality`) and the
  subtitle style (`subtitleStyle`) live in player preferences. Summaries must read them from there.
- **The AI toggle** must still call `forgetMediaOptions()` before `onUpdate`.
- **Polling.** The server log polls every 2s; it may only run while the Server category is shown.
  The home list's Server summary fetches the uptime once, it does not poll.
- **Android-only controls.** Nightly and Stop exist only when `window.SestudioApp` offers them.
- **Callers** that open Settings should open the right category: `WatchersIntro` ("set up
  WhatsApp") → `s=notifications`; Home's Health widget and NowStrip health items → the category
  the issue is about, else the home list.
- **Phone vs desktop** is decided by the `md` breakpoint at render time (`matchMedia`), not by
  CSS alone: on desktop `#/settings` must render Playback, on a phone the home list.

## 5. Build plan (PRs)

Files: `frontend/src/views/settings/`, one file per category plus `SettingsView.tsx` (the
frame, which also lists the categories), `useSettingsStatus.ts` (summaries, attention) and `rows.tsx`
(`SettingsGroup`, `SettingRow`, `ToggleRow`). `views/SettingsView.tsx` goes away.

### PR 1: The frame and routing
- `?s=<id>` routing, the phone home list (names and icons, no summaries yet), the desktop
  two-column layout, phone subpages with back + category name.
- Each category renders today's sections **unchanged**, moved into its file. The Danger zone's
  three controls move to Downloads and Server. Nothing is restyled yet.
- Callers deep-link to their category (§4).

### PR 2: Rows, then Playback and Subtitles
- `rows.tsx` primitives. Playback and Subtitles rebuilt on them, with the approved copy;
  language as `Choice`; the sticky subtitle preview.

### PR 3: Sources & search, Notifications
- Sites as a toggle list with their host names; TMDB key and CallMeBot key as one row each
  (status + Replace / Remove); the YouTube & Twitch row.

### PR 4: Downloads and Music
- Destination as `Choice`, folder row, try-first chips with one line of help, delete toggle.
- Music: libraries as rows, genre model, cookies, tokens, on the same primitives.

### PR 5: Server and Share
- Status header (dot, uptime, Restart, Stop), the log, Restart server command, Nightly, the JS
  runtime warning. Share: the two QR codes side by side on desktop, stacked on a phone.

### PR 6: Summaries and attention
- The summary line on every home-list row, the amber attention rows (phone) and dots (desktop).

## 6. Checks for every PR

- `npm run build` and `npm test` in `frontend/`; rebuild right away (see CLAUDE.md).
- Look at it at 390px and 1280px: `#/settings`, `#/settings?s=<each id>`.
- Every setting still saves and survives a reload; keys stay write-only.
- Keyboard: categories and rows reachable with Tab, visible focus, Back works.

## 7. Sizes

| PR | Size |
|---|---|
| 1 | M (moves most code, little new) |
| 2 | M |
| 3 | S |
| 4 | M |
| 5 | S |
| 6 | S |
