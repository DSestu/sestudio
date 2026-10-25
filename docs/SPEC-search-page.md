# Spec: search results page redesign

> Agreed through mockups, 2026-10-25. The mockups were built on the live app's look and data
> (posters, counts and file numbers below are real unless marked *invented*).

## 1. Why

On a phone, the first poster for "dune" sits about 1.7 screens down: Watch, sort, 4 toggles,
layout, release presets, 2 date fields, On disk and a People band of 12 strangers without photos
all come first. Every result looks the same, so the film you meant has the same weight as an
unrelated series. What's already on disk is folded away, and with large shows (South Park:
749 files) there is no way to get at an episode from search.

## 2. Goals

1. **Answer first.** When one result is clearly what you meant, show it big with Play next to it.
2. **Controls on demand.** Keep every option the page has today, folded behind one control.
3. **Your disk is part of the answer.** Shows, seasons and episodes you already have are one tap away.
4. **Sources are visible and filterable**, with counts, and the layout scales to many sources.
5. **Smooth motion**, never in the way, and off under reduced motion.
6. Phone and desktop both first-class.

### Non-goals

- Changing the title detail / watch pages, the Downloaded page or Discover browsing.
- New sources, or streaming results per source (planned as a later step, §11).
- Cross-device watch state (it stays in the browser, per device, as today).

## 3. Page structure

Top to bottom:

| Zone | Desktop | Phone |
|---|---|---|
| Search | Field in the top bar, as today (`Ctrl K`) | **Row 1, alone**, full width, with a clear button |
| Categories | Kind pills in the top bar, as today, each with its count | **Row 2, alone**: a segmented control `All · Films · Series · Anime` (+ `People` when it qualifies) with the count under each label, on one line that never wraps, plus a square **Options** button pinned right |
| Options fold | `Options ▾` after the pills; opens inline under the bar | Opens inline under row 2 |
| Sources | Chip row with count bars + a button that opens the **Sources panel on the right** | Row 3: chips scroll sideways; the button opens a **bottom sheet** |
| Episodes on your disk | Accordion (only when episodes match) | Same |
| Top match hero | Only when the rule in §5 picks one | Same, stacked |
| Rows by kind | Films, Series, Anime, each with `See all ›` | Same, narrower posters |
| People | Person hero or compact row, only per §8 | Same |

On a phone, scrolling down folds row 1 away and rows 2–3 stay stuck to the top (blurred
background, hairline border once stuck); scrolling up brings row 1 back.

The desktop keeps search and kind pills in one top bar: there's room, and a second row would
push the results down (assumption, see §13).

## 4. Options fold (replaces today's toolbar)

One button, `Options`, next to the kind pills. **Nothing is removed**; the fold holds exactly
today's controls:

- **Sort**: the 6 search sorts (`SORTS_FOR.search`): Default order, Title A–Z, Title Z–A,
  Newest, Oldest, Top rated.
- **Released**: the 5 presets (Any, Last month, Last 3 months, Last year, Last 5 years), the
  From/To dates, and today's notes ("dated by year only", "N hidden by this window").
- **Display**: Grid/Details layout; One card per show (`collapse_seasons`); TMDB posters;
  Group by TMDB match (keeps its regrouping spinner, hidden without a TMDB key); Play on open.
- **Actions**: Select all (enters select mode → today's bottom bar with Clear / Download all),
  Watch this search.
- **Reset all**.

Behaviour:

- **Closed**, the button shows a summary of what isn't at its default, e.g.
  `Options · Top rated · Last year`; on a phone, a dot on the square button.
- **Open**, it pushes the page down (inline, not an overlay) and remembers being open
  (local storage, like `libraryLayout`).
- URL state stays as today (`q`, `from`, `to`, `only`), plus the new `src` (§7).
- Desktop: 3 columns (Sort / Released / Display) and a footer row (count, Select all, Watch,
  Reset). Phone: stacked; chip rows scroll sideways inside the fold.

## 5. Top match (hero)

### Rule

1. Normalise titles (lowercase, strip accents, punctuation and leading le/la/les/the) and
   compare with the normalised query. Only an **exact** match can be the top match.
2. Among exact matches, a title **you are watching** (watch state) **or have on disk** wins.
3. Otherwise the exact match with the most **TMDB votes** (`vote_count`) wins, **if** it has at
   least **3×** the runner-up's votes. Real case: Dune 2021 has 15,805 votes vs 3,586 for 1984 → hero.
4. A **year in the query** is decisive ("dune 1984" picks 1984).
5. The active **kind** filter narrows the candidates (Series selected → only series qualify).
6. If nothing qualifies: **no hero**. Rows start at the top ("one" has no exact match).

The rule is a pure function (`pickTopMatch(cards, meta, query, kind, onDisk, watching)`) with
unit tests for each line above.

### Hero content

Blurred version of its own poster behind; poster; "Top match"; title; kind · year · length ·
genres · rating pill; 3-line synopsis; actions **Play** (or **Resume · S14 E13** / **Play · on
disk**), Watchlist, Download, `N sources ›`.

While TMDB votes are loading, the hero slot is a skeleton **of the same height**, so nothing
below jumps when it resolves; if no result qualifies, the slot collapses (240 ms).

## 6. On disk

**Rule: the search page shows shows, never files.** Files only appear inside a show.

### Grouping

On-disk titles are grouped into **shows** before anything is shown. Real data that must work:

- **South Park**: 749 files, 46 folders, 2 folder names (`south-park-la-serie-vf`,
  `south_park`), and most S14 episodes present twice (plus unnamed `s14e2`-style files).
  → One show, 26 seasons; duplicate episodes merge into one row showing "2 copies".
- **One Piece**: 133 folders of 1 episode each
  (`One Piece Yabai - 042 - … - 1080p.MULTI…`, `One Piece Kaï - 099 - …VOSTFR…`).
  Episodes 1–68 are the Yabai cut (MULTI) and 69–133 the Kaï cut (VOSTFR): consecutive, not
  duplicates. → One show with two "cuts" that act as its seasons.

Downloaded titles carry no TMDB id, so grouping uses a cleaned name (strip episode number,
episode title, quality, language, release-group tags), then TMDB enrich on that name to merge
spellings. `groupOnDisk(titles)` is a pure function tested on fixtures shaped like the two cases above.

### Where it shows

- **Hero** (top match on disk): one line `On disk · 26 seasons · 749 episodes · 99 GB`, and Play
  becomes **Resume · S14 E13** (from watch state; "Play S01 E01" with no history).
- **Season rail (E1)**, top match only: a horizontal **scrolling** row of `Season N` pills that
  opens centred on the current season (watched seasons outlined, current filled), with ‹ ›
  arrows and edge fades on desktop, a half-cut pill on phone. Under it, an episode rail for that
  season (frame thumbnail from `/downloaded/thumb`, ✓ watched, progress bar, Resume marker),
  scrolled to the resume point. Picking a season slides the episode rail out and in.
  Seasons with nothing on disk don't appear.
- **Cards** in rows get an `ON DISK` pill.
- **Several shows on disk, no hero**: they show as regular cards with the pill; "All on disk ›"
  opens the Downloaded page filtered on the query.

## 7. Sources

### Chips

One chip per source: **2-letter avatar** in a colour derived from the name (so FStream `FS` and
French-Manga `FM` stop both reading "F"), name, **count**, and a thin **count bar** scaled to the
biggest source.

- **Count = results you'll see** when you select it (after one-card-per-show and the kind
  filter), not raw listings (assumption, §13). A title on several sources counts for each.
- Click to filter; several can be selected; a title stays visible if **any** selected source
  has it; `Clear` resets. Selection is in the URL (`src=`), reset on a new query.
- Sorted by count, biggest first; selected chips always stay visible.
- **One line only.** What doesn't fit goes behind a final button (`▣ +N`).
- Sources that found **nothing** leave the row; **failed** sources collapse into one red
  `N failed ↻` chip.
- Cards show at most 2 source avatars, then `+N`.
- Disabled sources (Settings) never appear.
- Real "one piece" counts: FStream 15, French-Manga 20, KissKH 74 (mostly loose matches like
  "Twenty Five Twenty One"), UniqueStream 30.

### Sources panel (desktop) / sheet (phone)

The `+N` button opens:

- **Desktop**: a panel on the **right** that **pushes** the grid narrower (overlays it below
  ~1100 px). While it's open the chip row folds away and a short "Showing: Kumo" line keeps the
  active filter visible. It remembers being open.
- **Phone**: a bottom sheet with the same list.

Content: a filter box; **Found results** (checkbox, avatar, name, bar, count, `only` on hover);
**Found nothing**; **Didn't answer** (red, `↻ Retry` per source, `Retry all`).

### Loading

A thin progress bar and `Searching 14 sources · 9 answered`, which becomes
`14 sources · 9 with results · 3 found nothing · 2 failed`. Chips pop in as their source answers
(true per-source arrival needs streaming, §11; until then they appear together).

## 8. People

- A person is shown **only with a photo** (`profile_url`).
- If the query matches **no title exactly** and the first person hit (TMDB orders by
  popularity) has a photo, that person **takes the hero slot**: photo, name, department,
  "known for", a Known-for poster row, `Filmography ›`. Real case: "villeneuve" → Denis Villeneuve.
- Other people with photos: one compact row ("Also named Villeneuve").
- `People` appears as a kind only when someone qualifies. For "dune" (12 people, none with a
  photo) the People section doesn't exist.

## 9. Episodes on your disk (E3)

The query is also matched against **episode titles** of files on disk (already in memory).
Hits show in an **accordion** placed above the hero.

- **Closed**: a tinted band with a disk icon, `Episodes on your disk · 6`, the shows it covers
  (`South Park ×4 · Loki · 911 Mysteries`) and a fan of 4 thumbnails.
- **Open**, two layouts:
  - **Grouped (default)**: each show is a header (poster, name, count, `Open show ›`), and its
    episodes are listed under it with their code (`S03 E10`), title, thumbnail and Play.
  - **Tree**: show › season › episode, each level folds. Used automatically when one show has
    hits in more than ~3 seasons **and** more than ~10 episodes; a Grouped/Tree switch lets you change it.
- Real case "myst": South Park S03E10, S10E09, S11E05, S14E12; Loki S01E05; 911 Mysteries (film).
- No episode match → no accordion.

## 10. States

| State | What shows |
|---|---|
| Searching | Source progress line; hero skeleton (fixed height); row skeletons that shimmer |
| Titles in, top match resolving | Rows rise in (stagger); hero skeleton stays |
| Nothing found | "Nothing for 'dnue'", **Search 'dune' instead** (TMDB suggestion, §11), **Watch 'dnue'** |
| Kind filtered to zero | "No anime for 'dune' · 9 films and 2 series matched" → **Show everything** |
| Released window filtered to zero | "Nothing released last month · 12 results are older" → **Widen to Any** / Last 5 years |
| Some sources failed | Red failed chip + "N didn't answer · Retry"; results from the others show normally |
| All sources failed | "Sources didn't answer" → **Retry**; on-disk matches still show ("Still on your disk") |
| Select mode | Checkboxes on cards, today's bottom bar (Clear / Download all) |

**See all**: one kind as a full grid (6 columns desktop, 3 phone) with the same Options fold
(summary carries over) and the source chips. Desktop keeps the kind pill selected; phone swaps
the search bar for a title bar (`‹ Films · 9 for "dune"`). Back restores the answer page and
its scroll position.

## 11. Backend changes

1. **Per-source status and timeout in `/api/search`** (needed by §7).
   Response becomes `{cards: [...], sources: [{id, name, status: ok|empty|failed|timeout, count, ms}]}`.
   A per-source timeout (configurable, default ~8 s) marks a slow source `timeout` instead of
   holding up the page. Clients: `searchSeasons` / `searchSeasonsCached` in `api.ts`, the
   `SourcePicker` preview, tests in `tests/web/test_search_route.py`.
   Retrying one source: `/api/search?q=…&sites=kisskh`.
2. **"Did you mean"**: `GET /api/tmdb/suggest?q=` returns the best TMDB title for a query, called
   only when a search comes back empty.
3. **Escaped quotes**: FStream titles arrive as `Dans l\'ombre des dunes`; unescape in the scraper.
4. *Later*: **stream results per source** (NDJSON or SSE) so fast sources show immediately.
   Worth it beyond ~6 sources.

## 12. Motion

| What | Spec |
|---|---|
| Easing | `cubic-bezier(.2,.8,.2,1)` everywhere; no bounce |
| Accordions, Options fold, chip row fold | 240 ms; height via `grid-template-rows: 0fr → 1fr` + fade; chevron rotates 180°; children rise 8 px, stagger 30 ms |
| Arriving results | Skeleton shimmer; cards rise 8 px in 320 ms, stagger 25 ms; hero cross-fades from a same-height skeleton |
| Filtering (kind, source) | Leaving cards fade out; remaining cards slide to their new place (FLIP, 280 ms); returning cards scale in from .92 |
| Season change | Episode rail slides out 160 ms toward the old season, in from the new side; season rail scrolls smoothly to centre |
| Sources panel | Width 320 ms; content slides 16 px and fades in |
| Phone sticky header | Search row folds in 260 ms on scroll down, returns on scroll up |
| Segmented control | Selection thumb slides 260 ms |
| See all | 300 ms horizontal push; Back reverses |
| Chips, toggles | Colour 160 ms; switch knob 240 ms |
| Reduced motion | `prefers-reduced-motion: reduce` → no transitions, no shimmer |

Motion tokens live in one place (CSS custom properties) so every component uses the same values.

## 13. Assumptions to confirm

These were proposed and not explicitly confirmed; the plan follows them unless told otherwise.

1. Phone categories use the **segmented control** (V1), not scrolling pills (V2).
2. Desktop keeps **search and kind pills in one top bar**.
3. Source chip count = **results you'll see**, not raw listings.
4. The per-source **timeout ships with the first PR**; streaming comes later.
5. The Sources panel **pushes** the grid on wide screens, **overlays** below ~1100 px, and the
   chip row folds away while it's open.

## 14. Accessibility

- Kind control: `radiogroup`; segmented items are `radio` with counts in their label.
- Options fold and accordions: `button` with `aria-expanded` / `aria-controls`.
- Source chips: `button` with `aria-pressed`; the panel is a labelled `region` (desktop) or
  `dialog` (phone sheet) with focus moved in and returned on close.
- Season rail: `tablist`/`tab`; arrows are buttons with labels; keyboard ←/→ moves seasons.
- Every state change that hides results says so in text (counts, "N hidden by this window").
- Colour is never the only signal (counts and labels next to bars and avatars).

## 15. Plan (one PR each, in order)

Each PR: frontend rebuilt (`npm run build`), tests green, phone and desktop checked.

| # | PR | Depends on | Done when |
|---|---|---|---|
| 1 | **Search response: per-source status + timeout**; `sites=` param; client adapter | – | Route tests cover ok / empty / failed / timeout; the app works unchanged |
| 2 | **Unescape FStream titles** | – | Scraper test with `l\'ombre` |
| 3 | **Motion tokens + phone header** (search row alone, segmented kinds with counts, Options square button, sticky header that folds the search on scroll) | – | Phone: no wrapping at 320–430 px; desktop unchanged |
| 4 | **Options fold** replaces the toolbar, Watch button and release row; summary when closed; remembers open state | 3 | Every current control reachable; URL params unchanged |
| 5 | **Source chips + filter** (`src=`), avatars, counts = visible, failed/empty handling, retry one source | 1, 4 | Filter tests; failed source shows ↻ and retries alone |
| 6 | **Sources panel (desktop) / sheet (phone)** with the histogram list | 5 | Push ≥1100 px, overlay below; selection shared both ways |
| 7 | **Top match + hero + rows by kind + See all** (pure `pickTopMatch` + tests) | 4 | Rule tests (exact, history, 3× votes, year, kind, none); no layout jump |
| 8 | **On-disk grouping** (pure `groupOnDisk` + fixtures) → hero On-disk line, Resume, `ON DISK` pills | 7 | South Park → 1 show / 26 seasons / copies merged; One Piece → 1 show / 2 cuts |
| 9 | **Season rail + episode rail (E1)** | 8 | Opens centred on resume season; smooth scroll; keyboard |
| 10 | **Episodes accordion (E3)**, grouped + tree | 8 | "myst" gives 6 hits in 3 groups; tree switch rule |
| 11 | **People rule** (photo required, person hero) | 7 | "villeneuve" → person hero; "dune" → no People |
| 12 | **States**: skeletons, empty/filtered/failed, "did you mean" (`/api/tmdb/suggest`) | 1, 7 | Each state in §10 reachable in a test or by hand |
| 13 | *Later*: **stream results per source** | 1 | Fast sources render before slow ones |

## 16. Files this touches (starting points)

- `frontend/src/views/SearchView.tsx`: page composition (today: toolbar, ReleaseFilter,
  On disk `<details>`, PeopleResults, ResultsGrid/List).
- `frontend/src/components/search/DesktopSearch.tsx`, `SearchParts.tsx` (KindChips), `SearchBar.tsx`.
- `frontend/src/components/ResultsGrid.tsx`, `ResultsList.tsx`, `PeopleResults.tsx`, `SourcesBadge.tsx`.
- `frontend/src/components/ReleaseFilter.tsx`, `SortSelect.tsx`, `ToolbarToggle.tsx`, `LayoutToggle.tsx`.
- `frontend/src/downloadedFolders.ts` (`buildFolders`), `downloadedLibrary.ts`, `watchState.ts`.
- `frontend/src/sortItems.ts`, `useMergedCards.ts`, `useTitlesMeta.ts`, `api.ts`.
- `src/sestudio/web/routes/search.py`, `routes/tmdb.py`; FStream scraper under `src/sestudio/sites/`.
- Tests: `frontend/src/*.test.ts` (vitest), `tests/web/test_search_route.py`, `tests/web/test_tmdb.py`.
