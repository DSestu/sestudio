# Spec: the watch page (single items, seasons on one page, collapsed playlist)

> Agreed through mockups, 2026-11-01 and 2026-11-02, after the glass nav redesign
> (docs/SPEC-nav-redesign.md) shipped. The approved mockup is
> [`docs/assets/watch-page-mockup.html`](assets/watch-page-mockup.html): open it in a browser
> and use its A / B / C tabs. It is the visual reference for every PR below. Where this text
> and the mockup disagree, this text wins.

## 1. Why

- **A single item looks empty.** A film or a video gets the same layout as a 60-episode show:
  a playlist column holding one row.
- **Seasons are separate pages.** Picking another season navigates to a new watch page,
  remounts the view and drops the player into the mini-player.
- **The collapsed playlist is useless.** It is a 3rem strip that says "58 episodes" in
  vertical text, behind a small arrow nobody sees.
- **The watch page predates the glass identity.** It still has its own title row and its
  own tab style, unlike every other page.

## 2. What was decided

| Topic | Decision |
|---|---|
| A, single item | The right column exists only when there is a real list for it. TMDB film with recommendations → **Similar titles**. YouTube / Twitch video → **More from <channel>**. Anything else (a local file with no TMDB match, a film with no recommendations, a channel that fails to load) → no right column; the player is centred, max 55rem wide. |
| B, seasons | Every season is in one accordion in the playlist. Opening a season loads its list in place, with skeleton rows first and then the episodes fading in one by one. Several seasons can be open at once. A row of season pills (S1…Sn) opens a season **and scrolls it to the top of the list on the first click**, with a short flash on its header. Playing an episode from another season switches season **without remounting the page**: the player stays, there's no "Loading…", and no mini-player appears. |
| B, last seasons | The last seasons can scroll all the way to the top. Empty space below the last season makes that possible. |
| C, collapsed playlist (desktop ≥ 1024px) | Collapsed, the playlist is a glass rail, a twin of the nav rail on the left: 84px wide, with an **Episodes** item at the top, then **Playing**, **Next** and the **episode map** (one square per episode: watched, playing, started). **Hovering** the rail opens the full list over the player as a glass sheet, with **exactly the Discover flyout's motion and timing**. A **pin** in the sheet's header, or a **click on any empty spot of that header row**, keeps it open: the column grows to 24rem with the 360ms grid animation. Clicking the pin (or the empty header) again folds it back into the rail. |
| C on touch (no fine pointer) | Tap the rail to open the sheet. A dimmed scrim covers the player; tapping it closes the sheet. Playing an episode also closes the sheet. |
| Page header | The watch page uses `<PageHeader>` like every other page: back, title, a status line, and a ⋯ menu. **Watch for new episodes, Watchlist and Favourite move into the ⋯ menu.** (The user didn't answer whether Watch should stay a visible button. If they ask for it, move only `WatchToggle` out of the menu into the toolbar.) |
| Phone tabs | Episodes / Sources / Output stay under the player. They use the `Segmented` control from `PageHeader` with the sliding pill, and are not in the top card. |
| Panels | The playlist and side panels are flat `bg-base-200 rounded-box` with no border, like Home's widgets. Glass is only for what floats: the rail, the hover sheet and the header card. |
| Active states | Use the app's active pill everywhere: `bg-primary/22`, radius 10px, `text-primary`. The playing episode row uses it instead of today's ring outline. |
| Out of scope | Download select mode (the checkboxes stay as they are today). Blocks of 50 squares for very long anime in the episode map. Both are noted in §8. |

## 3. Building blocks that already exist (reuse them, don't rewrite them)

| Need | Where |
|---|---|
| Glass material | `glass` utility, `frontend/src/index.css` (`@utility glass`) |
| Glass round button | `GLASS_BUTTON`, `frontend/src/pageHeader.ts` |
| Page header (phone top card + desktop card slots) | `frontend/src/components/PageHeader.tsx` |
| Segmented control with sliding pill | `Segmented` in `PageHeader.tsx` (not exported yet; PR 1 exports it) |
| Easing | `ease-smooth` / `var(--ease-smooth)` = `cubic-bezier(.2,.8,.2,1)` |
| Discover flyout motion | `frontend/src/components/AppShell.tsx`: the `peek` state, `peekProps` (open on enter, close 150ms after leave, keyboard focus too), and the flyout `div` classes: `transition-[opacity,translate,filter] ease-smooth`, open `duration-300 [filter:none]`, closed `duration-200 opacity-0 -translate-x-3 pointer-events-none [filter:blur(10px)]` |
| Rows that follow a panel in | `.rows-follow` in `index.css`: 260ms, delays 90ms + 35ms per row, capped at 300ms; they leave together |
| Nav rail item markup | `RailItem` in `AppShell.tsx` (icon in a `w-13 h-8 rounded-[10px]` box, 11px label) |
| Collapse preference (persisted, server-synced) | `frontend/src/playlistCollapsed.ts`: `usePlaylistCollapsed()` / `togglePlaylistCollapsed()`. `collapsed = true` means the rail; `false` means pinned open. |
| A season's episodes | `getSeason(url, lang, source)` in `api.ts` |
| The show's seasons | `useShowSeasons(...)` in `useShowSeasons.ts`: `ShowSeason { season_number, page_url, source, current }` |
| Watched / progress for any season | `watch[watchKey(seriesName, seasonNumber, epNumber)]` (`watchState.ts`) |
| A channel's videos | `fetchChannel(url)` → `ChannelInfo.videos: VideoInfo[]`; `videoSeasonCard(v)` turns one into a `SeasonCard`; `channelHref(url, source)` links to the channel page |
| Downloaded file info | `downloadedLibrary.ts`: `fileFor`, `fmtSize`, `langsFor`, `titleFor` |

## 4. Traps (read before touching anything)

1. **Two `WatchView`s can be mounted at once**: the playing title and a browsed one, with the
   hidden one in a `<div hidden>` (`App.tsx`, `watchViews`). Anything global, like
   `<PageHeader>`, portals or window listeners, must only render or run when `visible` is true.
2. **The `list` element is rendered twice**: once in the phone Episodes tab and once in the
   desktop aside, and both are mounted. Anything desktop-only (the pin, the header-row click,
   the follow-in rows) must go to the desktop instance only. Turn `list` into a small
   `renderList(desktop: boolean)` function.
3. **App keys each watch view by `rec.u` (the page URL)**, and every season has its own URL. That
   key is why a season switch remounts the page today. PR 3 changes it carefully; don't change it
   anywhere else.
4. **`useSeasonDetail` keeps the old `detail` while it refetches.** It doesn't reset `loading` to
   true on a new URL. PR 3 relies on that, so don't "fix" it.
5. Desktop is `lg` (64rem). Everything in C is `lg` only. Below that, the phone tabs are used.
6. **Reduced motion:** no translate and no blur, only a 120ms fade (nav spec §6). Every new
   animation needs a `motion-reduce:` variant or a `prefers-reduced-motion` CSS block.

## 5. Build plan (PRs)

Five PRs. Each ships on its own and can be tested in the live app. Do them in this order.
After every PR, run the checks in §6.

---

### PR 1: The watch page joins the glass header

**Goal:** the watch page's own title row is gone. It uses `<PageHeader>`, the phone tabs become
the `Segmented` control, and panels lose their borders.

**Files:** `components/PageHeader.tsx`, `views/WatchView.tsx`.

Steps:

1. `PageHeader.tsx`
   - Export `Segmented`: change `function Segmented` to `export function Segmented`.
   - Add two optional props to `PageHeader`:
     - `away?: boolean`, passed to `<TopCard away={away}>`.
     - `wrapTitle?: boolean`. When it's true, `CardTitle`'s `<h2>` uses `line-clamp-2 break-words`
       instead of `truncate`. Add the same prop to `CardTitle`. Long video titles must stay
       readable: #181 and #206 fixed exactly this, so don't regress it.
2. `WatchView.tsx`, header
   - Add a `scrolled` state: `window.scrollY > 8`, with a scroll listener that is only attached
     while `visible`. Copy AppShell's `watchScrolled` effect. The phone card must leave the pinned
     player alone once you scroll.
   - Render `{visible && <PageHeader … />}` near the top of the returned JSX, with:
     - `title={seriesName}`, `wrapTitle`, `away={scrolled}`
     - `onBack={() => { if (history.length > 1) history.back(); else navigate('search') }}`
       (the same behaviour as today's back button)
     - `status`: the same pieces as today's grey line, joined with `' · '`:
       - kind: `Film` / `Video` for `detail.is_film`; otherwise `<em>{n} seasons</em>` when
         `showSeasons.length > 1`, else `Season {detail.season}`
       - `meta?.year`
       - for videos, the channel `<a>` link exactly as today
     - `menu={detail && <>…</>}`, containing `{!isVideo && <WatchToggle … variant="button" />}` and
       `<SaveToggles entry={…} />`, both with today's props. Move them; don't duplicate them.
   - Delete the old title-bar block, the `div` starting with the comment "Title bar. On desktop
     the search bar above it…", including its back button, `<h2>`, `WatchToggle` and
     `SaveToggles`.
3. `WatchView.tsx`, phone tabs
   - Replace the `role="tablist" className="tabs tabs-box…"` block with
     `<Segmented tabs={MOBILE_TABS.map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) }))} tab={tab} onTab={setTab} />`.
4. `WatchView.tsx`, panels
   - On the desktop `<aside>` and the phone Episodes container, drop `border border-base-300`
     and keep `rounded-box bg-base-200 overflow-hidden`.

**Done when**
- Phone: the glass top card shows ←, the title (two lines max), the status line and ⋯. ⋯ opens
  Watch / Watchlist / Favourite. Scrolling down hides the card, and it never sits over the
  pinned player.
- Desktop: the title, status and ⋯ sit in the glass card around the search field. There's no
  separate title row above the player.
- With one title playing and another being browsed, there's exactly one header, for the
  visible one.
- The phone tabs slide their pill between Episodes, Sources and Output.

---

### PR 2: Every season in one accordion

**Goal:** the playlist lists every season. Opening one loads it in place. The season pills
scroll on the first click. Playing an episode from another season still navigates, as today;
PR 3 makes that seamless.

**Files:** new `frontend/src/seasonCache.ts`, new `frontend/src/useSeasonLists.ts`,
`components/season/useSeasonDetail.ts`, `components/watch/EpisodeList.tsx`,
`views/WatchView.tsx`, `index.css`.

Steps:

1. `seasonCache.ts`: `getSeasonCached(url, lang, source)`.
   - A module-level `Map<string, { at: number; promise: Promise<SeasonDetail> }>` keyed by
     `` `${source}|${url}|${lang}` ``, with a 5-minute TTL.
   - Delete the entry when its promise rejects, so a failure is never cached.
   - Use it in `useSeasonDetail` in place of `getSeason`. It's a drop-in: same arguments, same
     result. This is what makes PR 3's switch instant: the season you opened in the accordion
     is already fetched.
   - Add `seasonCache.test.ts` with three cases: the same key gives the same promise, a
     rejection is evicted, and an entry expires after the TTL (use `vi.useFakeTimers`).
2. `useSeasonLists.ts`
   ```ts
   export type SeasonList =
     | { status: 'loading' }
     | { status: 'ok'; episodes: EpisodeDetail[] }
     | { status: 'error' }
   export function useSeasonLists(seasons: ShowSeason[], lang: string): {
     lists: Record<number, SeasonList>
     load: (seasonNumber: number) => void
   }
   ```
   - `load(n)` does nothing if `lists[n]` exists. Otherwise it sets `loading`, then calls
     `getSeasonCached(s.page_url, lang, s.source)`, which gives `ok` with `d.episodes` or `error`.
   - Reset `lists` when `lang` changes or the show changes. Key the reset on
     `seasons.map(s => s.page_url).join('|') + lang`, but **not** on which season is `current`:
     PR 3 changes `current` without changing the show.
   - The current season never goes through this hook. Its list is `detail.episodes`.
3. `EpisodeList.tsx`
   - Props: replace `onSelectSeason` with:
     - `seasonLists: Record<number, SeasonList>`
     - `onLoadSeason: (n: number) => void`
     - `onPlayOther: (season: ShowSeason, ep: EpisodeDetail) => void`
     - `watchOf: (season: number, ep: number) => { watched: boolean; progress?: number }`
   - State: `open: Set<number>`, initially `{season}`. When the `season` prop changes, add it to
     `open`; never remove others.
   - **Header row** (first row): `Episodes` (or `filmLabel`), then the row count in
     `text-base-content/45 text-xs`, then the `LangSwitcher` and `headerAction` on the right.
     The "N seasons" text moves to the page status (PR 1). The select-all row stays as it is.
   - **Season pills**, shown only when `seasons.length > 1`, placed in the header under the
     first row:
     - Markup like `Segmented`: `relative flex gap-1 rounded-xl bg-black/22 p-0.75`, with an
       absolutely positioned pill `rounded-[9px] bg-primary/24 transition-[translate,width]
       duration-300 ease-smooth` that slides to the **last-clicked** pill (initially the current
       season).
     - Each pill shows `S{n}` and, under it, a 3px track (`bg-white/10`) whose fill is
       `bg-success`, sized to watched / total. Total is known only for loaded seasons, so show
       no fill for the others.
     - The playing season's pill text is `text-primary`.
     - Click: add the season to `open` (`onLoadSeason` if it has no list), then `follow(...)`
       (below), then flash the season header for 700ms.
   - **`follow(scroller, el)`**, which scrolls on the first click even while the list below is
     still growing:
     - `scroller` gets `relative` so `el.offsetTop` is measured from it.
     - Run a rAF animation over 420ms with ease-out cubic from the current `scrollTop` to
       `min(el.offsetTop, scrollHeight - clientHeight)`.
     - Then run a settle loop that moves `scrollTop += (target - scrollTop) * 0.25` and
       recomputes the target each frame, until it is within 1px or 1400ms have passed in total.
     - Copy the logic from the mockup's `follow()`.
   - **Bottom spacer:** after the last season, render `<div aria-hidden style={{ height: spacer }} />`
     with `spacer = max(0, scroller.clientHeight - lastSeason.offsetHeight - 8)`. Recompute it
     with a `ResizeObserver` on the scroller and on the last season element.
   - **Season block**, one per season:
     - Header `button`: `sticky top-0 z-[1] bg-base-200` with a chevron that rotates 90° when
       open (`transition-transform duration-300 ease-smooth`), `Season {n}`, `{count} ep` in
       muted text, and on the right either a `Playing` chip (`bg-primary/22 text-primary`,
       10px bold, `rounded-md`) for the current season, or `{watched}/{total}` muted, then a
       44×4px track with a `bg-success` fill.
     - Clicking the header toggles `open` (and loads the list if needed).
     - Body: `grid transition-[grid-template-rows] duration-[280ms] ease-smooth`, with
       `grid-rows-[0fr]` when closed and `[1fr]` when open. The inner `div` is
       `overflow-hidden min-h-0`.
     - Rows go in `ml-2.5 pl-1.5 border-l border-base-content/10`.
     - While loading: 4 skeleton rows (`h-2.5 w-3/5 rounded bg-base-300 animate-pulse`).
       On error: one muted line, "Couldn't load this season", with a Retry button that resets
       the entry and calls `onLoadSeason`.
   - **Rows of the current season:** today's rows, unchanged, except the current row's
     `bg-primary/15 ring-1 ring-primary/40` becomes `bg-primary/22` with `rounded-[10px]`, and
     the title also turns `text-primary`.
   - **Rows of another season:** a simpler row with the number, the title, the watched tick and
     a progress bar from `watchOf`. No checkbox (downloads stay current-season only) and no
     language chips. Disabled when `embed_urls` is empty. Clicking it calls `onPlayOther`.
   - **Rows fade in, one after another:** each row gets class `ep-in` and
     `style={{ '--i': Math.min(index, 12) }}`. In `index.css`:
     ```css
     @keyframes ep-in { from { opacity: 0; translate: 0 6px } }
     .ep-in { animation: ep-in 240ms var(--ease-smooth) both; animation-delay: calc(var(--i) * 30ms) }
     @keyframes ep-fade { from { opacity: 0 } }
     @media (prefers-reduced-motion: reduce) { .ep-in { animation-name: ep-fade; animation-duration: 120ms; animation-delay: 0s } }
     ```
     Only rows that mount animate, which is right: a season you open fades in, and a
     re-render doesn't.
   - Keep today's "scroll to the playing episode" effect.
4. `WatchView.tsx`
   - `const { lists: seasonLists, load: loadSeason } = useSeasonLists(showSeasons, activeLang)`.
   - `watchOf = (s, n) => { const w = watch[watchKey(seriesName, s, n)]; return { watched: !!w?.watched, progress: w && w.duration > 0 ? w.position / w.duration : undefined } }`.
   - `switchSeason(next, ep?)` gains an optional episode: pass `ep: ep?.number` in the
     `navigate('watch', …)` params. Pass `onPlayOther={(s, ep) => switchSeason(s, ep)}`.

**Done when**
- Breaking Bad: S1 is open. Clicking S4 opens it, shows skeleton rows, then the episodes fade
  in, and S4's header is at the top of the list **after one click**, flashing briefly.
  S5 also reaches the top.
- Two seasons can be open at once, and the chevrons animate.
- Season headers stay pinned while their episodes scroll under them.
- An episode in S3 is clickable and plays S3 (by navigating; still a remount until PR 3).
- A film, a video and a single-season show look as they do today, minus the old season tree.
- `npm test` passes, including the new cache test.

---

### PR 3: Playing another season doesn't leave the page

**Goal:** after PR 2, playing an episode of another season keeps the same `WatchView`
mounted. The player switches episode in place, and the URL and history still update.

**Files:** `App.tsx`, `views/WatchView.tsx`.

Steps:

1. `App.tsx`
   - Add `const titleKey = (rec: WatchRecord) => `${rec.src ?? 'fstream'}|${rec.t}``.
   - In `watchViews.map`, key each wrapper by `titleKey(rec)`. If both entries exist and share
     a `titleKey` (a second season of the playing show is being *browsed* from search), key the
     browse one `` `browse|${rec.u}` ``.
   - Pass a new prop `onSwitchSeason` to `WatchView`:
     ```ts
     onSwitchSeason={params => {
       // The record the route will derive from these params (same fields as `opened`),
       // so `sameWatch` sees no change and nothing remounts.
       const next: WatchRecord = { u: params.u, t: params.t, p: params.p, lang: params.lang,
         ep: params.ep, alt: undefined, src: params.src, altsrc: undefined }
       if (owner) setPlayingWatch(next)
       navigate('watch', params)
     }}
     ```
2. `WatchView.tsx`
   - New prop: `onSwitchSeason: (params: Record<string, string | number | undefined>) => void`.
   - `switchSeason` builds the same params as today, plus `ep`, and calls `onSwitchSeason(params)`
     instead of `navigate`.
   - Hide `{loading && <p>Loading…</p>}` once `detail` exists, so the old season stays on
     screen until the new one lands: `loading && !detail`.
   - Check that the picked episode plays: `initializedFor` already re-runs on the new `detail`
     and picks `episode` (the route's `ep`). Nothing to add if that works; test it.

**Done when**
- Desktop and phone: S1E3 is playing. Open S2 in the playlist and click E1. The video changes
  to S2E1 in place: no "Loading…", no remount flicker, no mini-player. The URL shows S2's page,
  and the open seasons stay open.
- Browser Back returns to S1.
- With "Play on open" off, browsing a show and switching season while something else plays
  doesn't take over the player.
- Opening another title from search still works as today (mini-player, browse vs play).

---

### PR 4: The collapsed playlist becomes a rail with a hover sheet (desktop)

**Goal:** this is mockup C. Replace the 3rem strip and the arrow button.

**Files:** new `components/watch/PlaylistRail.tsx`, `components/watch/EpisodeList.tsx`,
`views/WatchView.tsx`, `index.css`.

Steps:

1. **Layout** (`WatchView.tsx`, the `lg:grid` container)
   - Columns: collapsed → `lg:grid-cols-[minmax(0,1fr)_5.25rem]`; pinned →
     `lg:grid-cols-[minmax(0,1fr)_24rem]`.
   - Add `lg:transition-[grid-template-columns] lg:duration-[360ms] ease-smooth
     motion-reduce:transition-none`.
   - The right column wrapper is `relative lg:sticky lg:top-16 lg:h-[calc(100dvh-5.5rem)]`.
2. **`PlaylistRail.tsx`**, shown when `collapsed`
   - Container: `absolute inset-y-0 right-0 w-21 glass rounded-2xl flex flex-col items-center gap-2 py-2.5 px-1.75`.
   - First, an **Episodes** item with the same markup and classes as AppShell's `RailItem`
     (copy them) and a list icon. Clicking it does what tapping the rail does (step 4).
   - **Playing**: `S{s} · E{nn}`, centred, `rounded-[10px] bg-primary/22`, with the label
     "Playing" in 10px at 70% opacity and the value in 13px `text-primary` bold.
   - **Next** button: `▶ Next` with `S{s} · E{nn}` under it, `rounded-[10px] bg-white/6
     active:scale-92`. Clicking it calls `setCurrent(nextEp)` (`nextEp = playlist[index + 1]`
     in WatchView). Hide the button when there is no `nextEp`.
   - **Episode map**: `flex-1 min-h-0 overflow-y-auto`, no scrollbar. Per season: a
     `S{n}` label (10px bold, 55% opacity), then a 4-column grid of 13px squares
     `rounded-[4px]`, gap 4px:
     - watched `bg-success/65`
     - playing `bg-primary` with `ring-2 ring-primary/35`
     - started: `linear-gradient(90deg, primary/70 {pct}%, white/7 {pct}%)`
     - otherwise `bg-white/7`
     - `title="S01E03 · <title>"`; clicking plays the episode (current season → `setCurrent`,
       another season → `onPlayOther`)
     - A season that isn't loaded shows its label and a muted "—".
   - Fade the rail out when the sheet is open or pinned: `transition-[opacity,translate]
     duration-200 ease-smooth`, and when hidden `opacity-0 pointer-events-none`, plus
     `-translate-x-4` when pinned.
3. **The sheet**, the same `EpisodeList` + `downloadBar` as today's aside
   - Wrapper: `absolute top-0 right-0 h-full w-96 z-30 rounded-2xl overflow-hidden` with
     `data-open={peek || undefined}`.
   - **Peek** (`collapsed && peek`): `glass`, with the Discover classes mirrored for the right
     side: `transition-[opacity,translate,filter] ease-smooth`, open `duration-300 [filter:none]`,
     closed `duration-200 opacity-0 translate-x-3 pointer-events-none [filter:blur(10px)]`. The
     sign is `+`, because it slides out of a rail that sits on the right.
   - **Pinned** (`!collapsed`): no glass, `bg-base-200 rounded-box`, always open, and
     `data-pinned`.
   - **Rows follow in:** pass `follow` to the desktop `EpisodeList`. When it's set, give the
     header rows and each season block class `follow-row` and
     `style={{ '--d': `${Math.min(90 + 35 * i, 300)}ms` }}`, where `i` counts header rows first,
     then seasons. In `index.css`:
     ```css
     .follow-row { opacity: 0; translate: 8px 0; transition: opacity 260ms, translate 260ms var(--ease-smooth) }
     [data-open] .follow-row, [data-pinned] .follow-row { opacity: 1; translate: 0 0 }
     [data-open] .follow-row { transition-delay: var(--d) }
     @media (prefers-reduced-motion: reduce) { .follow-row { translate: none; transition-delay: 0s !important } }
     ```
     These are the same values as `.rows-follow`, mirrored to come from the right. They leave
     together because the delay only applies under `[data-open]`.
4. **Open and close**, in `WatchView.tsx` (desktop only)
   - `const [peek, setPeek] = useState(false)` and a timer ref.
   - `const fine = matchMedia('(hover: hover) and (pointer: fine)').matches`. Read it in an
     effect or a small hook; don't read it during SSR (there's none, but keep it inside an
     effect anyway).
   - With a mouse (`fine`), copy AppShell's `peekProps` on the right column wrapper:
     - `onMouseEnter`: clear the timer; if `collapsed`, `setPeek(true)`.
     - `onMouseLeave`: `timer = setTimeout(() => setPeek(false), 150)`.
     - `onFocus` / `onBlur`, the same as AppShell (keyboard).
   - On touch (`!fine`):
     - Tapping the rail calls `setPeek(true)`.
     - Render a scrim over the player column: `absolute inset-0 z-20 rounded-box bg-black/45`,
       fading over 300ms, only while `peek`. Tapping it calls `setPeek(false)`.
     - Playing an episode from the sheet also calls `setPeek(false)`.
   - Escape closes the peek.
   - Set `peek` to false whenever `collapsed` flips.
5. **Pin**
   - Replace `collapseButton` with a pin button: `w-8 h-8 rounded-[10px] grid place-items-center
     bg-white/6 active:scale-92` plus a pin icon, with `data-pin`.
     - Lit when pinned: `bg-primary/22 text-primary`.
     - `aria-pressed={!collapsed}`, `title`: "Keep open" / "Fold into the rail".
     - On click: `togglePlaylistCollapsed(); setPeek(false)`.
   - Pass it as `headerAction` to the **desktop** list only (trap 2).
   - Delete the old collapsed branch of the aside: the strip with the vertical "N episodes".
6. **Clicking the header row does what the pin does.** `EpisodeList` gets an optional
   `onHeaderClick`, passed to the desktop list only, as `togglePlaylistCollapsed` plus
   `setPeek(false)`.
   - The first header row gets `cursor-pointer rounded-[10px] -mx-1.5 px-1.5 transition-colors
     hover:bg-white/4` and, so the click is discoverable, `[&:hover_[data-pin]]:bg-primary/14
     [&:hover_[data-pin]]:text-primary`.
   - `onClick={e => { if (!(e.target as Element).closest('button,a,input,label,select,[role=button],.badge')) onHeaderClick?.() }}`.
     The language switcher, Select and chips keep their own clicks.
   - It's a mouse shortcut only: the pin stays the accessible control, so don't add a role.

**Done when**
- Desktop, collapsed: the rail is 84px, glass, the same height as the column, and the map
  shows the seasons.
- Hovering the rail opens the sheet over the player with Discover's motion: fade, 12px slide,
  blur → sharp in 300ms, header rows then seasons following 35ms apart. Leaving closes it
  after 150ms (200ms out), and re-entering within 150ms keeps it open.
- Clicking the pin, or empty space on the "Episodes 58 … VOSTFR" row, pins it. The grid grows
  from 84px to 384px over 360ms, the sheet loses its glass and the pin stays lit. Clicking
  either again folds it back. The state survives a reload (server preference).
- Clicking the VOSTFR switch or a checkbox in the header doesn't toggle the pin.
- Emulating touch (DevTools device mode, `pointer: coarse`): tap the rail → the sheet opens
  with the player dimmed; tap the dim → it closes.
- Reduced motion: no slides, only fades.
- Phone: no change from PR 2/3.

---

### PR 5: Single items get a right column only when there's a list

**Goal:** mockup A. Films and videos stop showing a one-row playlist.

**Files:** `views/WatchView.tsx`, `components/season/TitleHeader.tsx`, new
`frontend/src/useChannelVideos.ts`.

Steps:

1. **What decides the column** (`detail.is_film` is true for films and videos):
   - `similar = !isVideo ? meta?.recommendations ?? [] : []`
   - `more = isVideo ? useChannelVideos(videoLink?.channel_url, sourceUrl) : []`
   - `side = similar.length ? 'similar' : more.length ? 'more' : null`
2. **`useChannelVideos(channelUrl, exceptUrl)`:** `fetchChannel(channelUrl)` returns
   `videos.filter(v => v.page_url !== exceptUrl).slice(0, 8)`. Use `[]` while loading or on
   error, and keep a cancelled flag like `useShowSeasons`. When the url is undefined, return
   `[]` without fetching.
3. **Desktop layout for a single item**
   - The grid is `lg:grid-cols-[minmax(0,1fr)_20rem]` when `side`, otherwise a single column
     with the player column `lg:max-w-[55rem] lg:mx-auto w-full`.
   - No playlist aside, no rail and no collapse for single items.
   - **Download** moves into the desktop toolbar as `btn btn-primary btn-sm` with a download
     icon, at the end of the version row. It calls `handleDownload` (the single episode is
     already in `checked`). Phone: the same button at the end of the row under the player.
   - `side === 'similar'`: `<aside class="rounded-box bg-base-200 p-3">`, then "Similar titles"
     (13px semibold), then a 2-column poster grid (`aspect-[2/3] rounded-md object-cover`,
     title in 12px under each), at most 6. Clicking does what `TitleHeader` does:
     `navigate('search', { q: r.title })`.
   - `side === 'more'`: the same aside, with a header row "More from {channel}" and "See all ›"
     linking to `channelHref(channel_url, sourceId)`. Each row is a 120px 16:9 thumbnail
     `rounded-md`, the title clamped to 2 lines in 12px, and the relative upload time in 11px
     muted. Clicking opens the video the way ChannelView does: `const c = videoSeasonCard(v)`,
     then `navigate('watch', { u: c.page_url, t: c.series_name, p: c.poster_url, lang: activeLang, src: c.source })`.
   - `TitleHeader`: add a prop `similarOnPhoneOnly?: boolean` that wraps the "Similar titles"
     block in `lg:hidden`. Pass it when `side === 'similar'`, so desktop doesn't show the
     similar titles twice.
4. **A downloaded file with no column** (`sourceId === DOWNLOADED_SOURCE`): under the toolbar,
   one line `flex items-center gap-3 rounded-box bg-base-200 px-3 py-2.5 text-sm` with the
   file's relative path in `font-mono text-xs opacity-70`, `fmtSize(size)`, and "Downloaded"
   muted. Get the file from
   `fileFor(downloadedTitles, seriesName, season, currentNumber, activeLang)`.
5. **Phone for a single item**
   - Tabs are `['sources', 'output']` only, with the default tab `sources`. Make `MOBILE_TABS`
     depend on `detail.is_film`.
   - Similar titles stay in `TitleHeader` as today.
   - `side === 'more'`: render the "More from {channel}" list under `TitleHeader` (full width,
     the same rows).

**Done when**
- Inception (TMDB): the player and toolbar sit left with Download in the toolbar, and the
  similar titles are on the right. No one-row playlist. Phone: Sources / Output tabs only.
- A YouTube video: "More from <channel>" with thumbnails on the right. "See all" opens the
  channel, and a row opens that video.
- A local file with no TMDB match: the player is centred, with the file line underneath. No
  right column and no empty panel.
- Shows (more than one episode) are unchanged from PR 4.

## 6. Checks for every PR

1. `cd frontend && npm run build`. The live server serves the committed `frontend/dist`. On the
   main checkout, build through Windows: `/mnt/c/Windows/System32/cmd.exe /c "npm run build"`.
2. `npm run lint` and `npm test`.
3. Look at it in a live preview at **both** 390×844 and 1440×900:
   - A scratch `frontend/vite.preview.config.ts` (react + tailwind plugins, port 5173,
     `watch.usePolling`, proxy `/api` → `https://localhost:8443` with `secure: false,
     changeOrigin: true`).
   - Run `npx vite --config vite.preview.config.ts --host 127.0.0.1`.
   - Delete the config afterwards. Never commit it.
   - Test titles: Breaking Bad (5 seasons), Inception (film with TMDB), a YouTube video from a
     followed channel, and a downloaded-only file.
4. Compare against `docs/assets/watch-page-mockup.html` (tabs A, B and C).
5. Commit flow, from this repo's CLAUDE.md: branch → commit → PR (title only, `--body ""`) →
   CI → merge. Never `git add -A`, because an untracked `~/` directory holds a browser profile:
   stage explicit paths.

## 7. Sizes

| PR | Effort |
|---|---|
| 1 Header | ~2 h |
| 2 Accordion | ~5 h (the biggest: EpisodeList rewrite, cache, follow scroll) |
| 3 Seamless switch | ~2 h, plus careful testing of play / browse / mini-player |
| 4 Rail + sheet + pin | ~5 h |
| 5 Single items | ~3 h |

## 8. Later (not in these PRs)

- Download select mode: rows without checkboxes until "↓ Select" is pressed. Proposed but not
  decided.
- Episode map for very long anime (several hundred episodes): group the squares in blocks
  of 50.
- Prefetch every season's list once the rail is visible, so the map is complete without
  opening seasons.
