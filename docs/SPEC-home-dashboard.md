# Home as a dashboard: brief

Status: draft brief, before mockups. Mode: **Operate**. Visual authority: the existing DESIGN.md world ("The Living-Room Auditorium"); this is a new surface inside it, not a new look.

## 1. Job and audience

- **Who:** the maintainer first, on the couch in the evening, phone in hand; the desktop browser second.
- **Job:** one glance at everything sestudio knows right now: what to resume, what is new, what is live, what is coming, what is downloading, whether anything is broken. Then act on it without leaving Home.
- **Success:** the most time-sensitive thing is the first thing seen, and the common action on it (play, resume, cast, retry) is one tap away.

## 2. Model: a grid of widgets, laid out automatically

- Home is a grid of **widgets**. Each widget has **one fixed size**, designed for its content. There is no edit mode.
- The app **orders widgets by urgency** (section 4). Order is computed when Home opens or is returned to, and **never reflows while it is on screen**: live data updates a widget's content in place and never moves it.
- A widget with nothing to show is **absent**, not empty. No empty widget shells.
- Widgets **act in place**: their main action (play, resume, cast, retry, download) works inside the widget. The widget header opens the full view (Library, Activity, Downloads, Discover, Settings).

### Sizes and grid

| Size | Phone (2 columns) | Desktop (4 columns) |
|------|-------------------|---------------------|
| **S** | 1 column, as tall as an M: a counter or a single item | 1 column |
| **M** | 2 columns, 3 grid rows (80px): one row of items | 2 columns |
| **L** | 2 columns, twice an M: one rich item plus a short list | 2 columns |

**One item fills its widget.** A widget's size is fixed, so its content adapts to the count: a single item is shown large and fills the frame; several items become rows (up to the widget's cap). Live now with one stream shows the stream thumbnail edge to edge, with the channel, title and Watch / Cast laid over a bottom gradient; with several it lists red-ringed rows. New episodes with one shows a single raised block (big poster, title, episode, version, Play, Download). Upcoming with one shows a faded, dashed poster beside a large dashed day tile and the line "Tell me when it's in VF".

Heights add up: an S is as tall as an M and an L is exactly two Ms, so widgets side by side always end on the same line.

S widgets pair side by side on the phone. Packing is dense: a gap left by an S is filled by the next S in order, even one with lower urgency. An S with no partner stretches to the full row width at the same height.

## 3. Widget catalogue

| Widget | Size | Shows | In-place actions | Absent when | Data |
|---|---|---|---|---|---|
| **Continue watching** | L | Lead item as a backdrop with title, episode, version and a progress bar; 2 compact rows below | Resume, cast | Nothing in progress | exists (watch state) |
| **New episodes** | M | Up to 3 unseen watcher findings: poster, `S2·E5`, version chip (VF/VOSTFR) | Play, download | No unseen findings | exists (Activity) |
| **Live now** | M | Live followed channels: avatar, stream title, platform | Play, cast | Nobody live | exists (`/live`) |
| **From your channels** | M | Latest videos from followed channels, 16:9 thumbnails | Play | No follows | exists (`/creators/latest`) |
| **Upcoming** | M | Agenda for the next 7 days: day, series, episode; "today" highlighted | Open title; "Tell me when it's in VF" (creates a watcher) | No followed series airs within 7 days | **new**: TMDB `next_episode_to_air` per followed series |
| **Downloads** | S | Active count and the current job's progress, or "3 finished" since the last visit, or a failure | Retry a failed job | Queue empty and nothing new since the last visit | exists (`/downloads`) |
| **On this device** | S | Count and size of offline copies on this browser/device | Open offline library | No device copies | exists (device downloads) |
| **For you** | L | "Because you watched X": TMDB recommendations, **only titles a site actually carries**, with version chips | Play, add to watchlist | No watch history yet | **new**: aggregate recommendations across recent titles, then match against sites |
| **Watchlist** | M | Poster row | Play | Empty | exists |
| **Favourites** | M | Poster row | Play | Empty | exists |
| **Discover** | M | First shelf of the last catalogue browsed | Play or search | No catalogue | exists |
| **Health** | S | The worst issue (watcher failing, disk low, site unreachable) | Retry | All good (then a footer status line instead) | partly **new**: disk free space and site reachability; watcher `last_error` exists |

Dropped from today's Home: the per-site browse rows.

## 4. Urgency: how the order is decided

Home has a fixed top and an ordered rest (variant C, chosen 2026-11-01):

1. **Now strip:** one row of chips at the very top, swiped sideways. Each urgent item is one chip: an icon, one line of text and one action. Examples: "Frieren E3, E4 ready · Play", "KissKH is down · Retry", "Skyyart is live · Watch", "Frieren S2·E5 airs today · VF bell". Tapping the chip's text opens the full view. The strip is absent when nothing is urgent. What counts as Now: someone followed is live, an episode airs today, a download finished or failed since the last visit, Health has an issue.
2. **Continue watching** is always the first widget, right under the strip.
3. **The other widgets**, ordered by tier; inside a tier, by catalogue order:
   - **Fresh:** Live now; unseen new episodes; channel videos newer than the last visit.
   - **Browse:** For you, Watchlist, Favourites, Discover, From your channels (when nothing is new), Upcoming.
   - **Status:** Downloads, On this device, Health.

A widget whose news is in the strip keeps its normal place lower down; the strip only adds the shortcut. "The last visit" is the last time Home was on screen, stored per device.

## 5. States

- **First run** (no history, follows or downloads): a welcome block ("What do you want to watch?", one line on what search covers, ghost buttons Browse catalogues and Follow a channel), then a Discover window on TMDB trending, then the status line. The phone shows a search field in the welcome block; desktop points to its existing search bar instead of adding a second one. No dashboard of empty shells.
- **Quiet day** (nothing live, new, downloading or airing): no Now strip, no badges or blue dots, no Upcoming. From your channels shows "latest" with desaturated faces. Health is not a widget: it drops to a one-line footer, "All good" in green with a small pulse trace and its facts (sites up, last watcher run, free disk).
- **Health:** a widget only when something is wrong (and then also a Now chip); otherwise the footer status line on every Home.
- **Loading:** each widget loads on its own, with a skeleton at its final size, so the grid never jumps. A widget whose fetch fails is absent, and Health records it.
- **Offline** (server unreachable): only On this device shows, plus a banner.
- **Ranges:** 0 to about 15 live channels; 0 to 50 or more in progress; 0 to 20 upcoming episodes a week; 0 to 30 downloads queued. Every widget is capped and links to its full view.

## 6. Layout and interaction intent

- Phone first: 2 columns, 16px gutters, the bottom tab bar is unchanged. The first screen holds the Now strip, Continue watching and the top of the next widget.
- Desktop: 4 columns inside the existing `max-w-6xl` content area; the sidebar is unchanged.
- Urgency is shown inside a widget too: a Signal Blue dot or count on its header while its content is new, cleared once seen.
- Widget surface: Aisle Dark, `rounded.box`, flat (no shadow), following the One Hue Ramp rule. Artwork carries the color.
- **Frames tell what is inside (chosen 2026-11-01).** Each widget's frame expresses the meaning of its content. The artwork glow ("Lit") is used only twice: the Continue watching backdrop and the For you spotlight.

| Widget | Frame | Why |
|---|---|---|
| Continue watching | Top edge is a 3px Signal Blue progress line filled to the lead item's position; blurred backdrop of the show | The frame is the timeline; you are inside the show |
| Live now | 1px red hairline outline, a pulsing LIVE tally (static under reduced motion), red avatar ring | The on-air light; same red as today's live rings |
| New episodes | Unseen rows sit on a raised Row Dark step; seen rows sink to the panel at 50% | Unopened is raised, like unopened mail |
| From your channels | Stacked faces of the channels with new uploads lead the header | Who it comes from comes first |
| For you | Corner spotlight from the top pick's poster (blur 36px, saturate 1.5, brightness 1.15, 70%, radial fade gone by two-thirds) | The pick lights itself |
| Upcoming | No fill, 1px dashed outline, dashed day tiles | It does not exist yet |
| Watchlist | A ribbon bookmark hanging from the top edge | Marked to come back to |
| Discover | No right edge; the frame and posters run off the screen | A window onto a catalogue that goes on |
| Favourites | Posters stand on a 1px ledge; one Ember Coral heart in the header | Kept on a shelf; warmth, not an action |
| Downloads | The frame fills from the bottom to the queue's progress, with a Signal Blue tide line | A vessel filling |
| Health | A pulse trace along the top edge: steady green when fine, broken amber on an issue | A vital sign |
| On this device | The only inset surface: House Dark, inner shadow | Kept in your pocket, not on the server |

Rules: each device appears once on Home, so it keeps its meaning; frames never compete with poster art for color; the Now strip chips carry a poster or channel thumbnail. Exceptions to DESIGN.md this needs: the inner shadow on On this device (an inset, not elevation), and Discover breaking the content padding.
- Motion: widgets rise in on first paint (the `rise` animation, staggered lightly), and nothing moves after that.

## 7. Decisions

- **Settled:** fully automatic layout; one fixed size per widget; act in place; phone first; Watchlist, Favourites and Discover stay; Health is added; per-site rows go.
- **Settled in mockups:** Now strip plus Continue watching as the hero (section 4); a lone S stretches to full width; frames tell what is inside (section 6); one item fills its widget (section 2); Health is a footer line unless something is wrong (section 5).
- **Search:** no search entry on phone Home (Search is a tab); desktop keeps its top search bar. Only the first-run welcome block carries a search field on the phone.
- **For you seeds:** the last 5 titles watched; one "Because you watched X" line, rotating through them; refreshed once a day.
- **Upcoming and VF:** show the original air date, with a muted line "VF usually ~N days later" when past episodes of that series give an estimate; otherwise "VOSTFR first". The VF button creates a watcher for that episode in VF.
- **"Followed series"** (for Upcoming): a series with a watcher, in progress, or on the Watchlist, that TMDB lists as returning.

## 8. Plan (one PR each, in order)

Each PR: frontend rebuilt (`npm run build`), tests green, phone and desktop checked. Backend PRs ship behind nothing: Home ignores endpoints it does not call yet.

| # | PR | Depends on | Done when |
|---|---|---|---|
| 1 | **Upcoming endpoint**: next episodes airing within 7 days for followed series (TMDB `next_episode_to_air`), cached 6 h; VF-delay estimate from past watcher findings | – | Route tests: returning series, ended series, none in 7 days, no TMDB id |
| 2 | **For you endpoint**: TMDB recommendations of the last 5 watched, deduped, minus watched / listed titles, kept only when a site carries them, with their versions; cached daily | – | Tests: dedupe, exclusion, a TMDB hit no site carries is dropped |
| 3 | **Health endpoint**: site reachability (cheap cached probe), watcher last run and last error, free disk on the downloads dir | – | Tests: all good, one site down, watcher error, low disk |
| 4 | **Widget grid foundation**: widget shell (S / M / L, lone S stretch, header, frame classes), pure `orderWidgets` (tiers, catalogue order) with tests, per-device last-visit marker, skeletons at final size; port Continue watching (hero + timeline frame), Watchlist, Favourites, Discover; drop per-site rows | – | Order tests; Home works with today's data; no layout jump while loading |
| 5 | **Now strip**: pure `nowItems` selector (live, airs today, download done or failed, Health issue) with tests; chips with one action each | 4 | Selector tests; strip absent when empty |
| 6 | **New episodes + Live now widgets** replace ActivityPeek and LiveNow; raised unseen rows, single-item block, live one-stream and rows layouts | 4 | Seen / unseen from Activity; 0 / 1 / 3 live render right |
| 7 | **From your channels** widget (`/creators/latest`): new since last visit vs "latest" | 4 | Badge only for new; calm state desaturated faces |
| 8 | **Downloads + On this device** widgets: filling frame, inset frame | 4 | Absent when nothing to show; fill tracks progress |
| 9 | **Upcoming widget** with the VF watcher button | 1, 4 | Dashed frame; one-item layout; button creates a watcher |
| 10 | **For you widget** with the spotlight | 2, 4 | Rotating seed line; only site-carried titles |
| 11 | **Health widget + footer status line** | 3, 4, 5 | Issue → widget and Now chip; all good → footer line |
| 12 | **States and DESIGN.md**: first run, quiet day, offline banner; record the frame language and the two exceptions (inset shadow, Discover bleed) in DESIGN.md | 4–11 | Each state in section 5 reachable by hand |

## 9. Files this touches (starting points)

- `frontend/src/views/HomeView.tsx`: today's composition (LiveNow, ActivityPeek, Continue watching rows, MediaRows, browse rows, Discover shelf).
- `frontend/src/components/LiveNow.tsx`, `ActivityPeek.tsx`, `library/WatchingRow.tsx`, `MediaRow.tsx`, `EmptyState.tsx`.
- `frontend/src/watchState.ts`, `collections.ts`, `notifications.ts`, `liveNow.ts`, `useDownloadJobs.ts`, `deviceDownloads.ts`, `rowItems.tsx`, `api.ts`.
- `src/sestudio/tmdb.py`, `web/routes/tmdb.py`, `web/routes/creators.py`, `web/routes/watchers.py`, `web/routes/settings.py` (`/server`), `web/routes/downloads.py`, `watchers/`.
- Tests: `frontend/src/*.test.ts` (vitest), `tests/web/`.
