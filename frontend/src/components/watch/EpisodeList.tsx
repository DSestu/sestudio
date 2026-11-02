import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { EpisodeDetail } from '../../api'
import type { ShowSeason } from '../../useShowSeasons'
import type { SeasonList } from '../../useSeasonLists'
import LangSwitcher from '../season/LangSwitcher'

interface Props {
  episodes: EpisodeDetail[]
  /** Episode number currently loaded in the player. */
  currentNumber: number | null
  checked: Set<number>
  watchedNumbers: Set<number>
  /** 0..1 progress per episode number, for part-watched bars. */
  progress: Record<number, number>
  langs: string[]
  activeLang: string
  /** Languages each episode is playable in, by episode number. Empty while the
   *  background probe is still running. */
  epLangs: Record<number, string[]>
  /** Episode titles seen in any language, so one missing here still has a name. */
  epTitles: Record<number, string>
  /** Languages each episode is already downloaded in, by episode number. */
  downloadedLangs: Record<number, string[]>
  /** Play an episode in a given language, switching the season if needed. */
  onSelectEpisodeLang: (ep: EpisodeDetail, lang: string) => void
  isFilm: boolean
  /** What a one-item title is called: "Film", or "Video" for a channel's. */
  filmLabel?: string
  season: number
  /** Every season of this show on this site, empty when there is only one. */
  seasons: ShowSeason[]
  /** The episodes of the show's other seasons, as far as they have been opened. */
  seasonLists: Record<number, SeasonList>
  /** Ask for a season's episodes; `retry` forces another attempt after a failure. */
  onLoadSeason: (season: number, retry?: boolean) => void
  /** Play an episode of another season (the page moves to that season). */
  onPlayOther: (season: ShowSeason, ep: EpisodeDetail) => void
  /** Watched flag and part-watched progress of any season's episode. */
  watchOf: (season: number, episode: number) => { watched: boolean; progress?: number }
  onSelect: (ep: EpisodeDetail) => void
  onToggle: (num: number) => void
  onToggleAll: () => void
  onLang: (lang: string) => void
  /** Flip an episode's watched flag. Owned by the parent, which holds the playlist. */
  onToggleWatched: (ep: EpisodeDetail) => void
  /** Ends the header row, after the language switch (the desktop collapse). */
  headerAction?: ReactNode
}

/** Scroll a season's header to the top of its list, on the first click even
 *  though the fold is still growing: an eased move, then keep aiming at it. */
function scrollSeasonIntoView(box: HTMLElement, el: HTMLElement) {
  const target = () => Math.min(el.offsetTop, box.scrollHeight - box.clientHeight)
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { box.scrollTop = target(); return }
  const t0 = performance.now()
  const from = box.scrollTop
  const settle = () => {
    box.scrollTop += (target() - box.scrollTop) * 0.25
    if (Math.abs(target() - box.scrollTop) > 1 && performance.now() - t0 < 1400) requestAnimationFrame(settle)
  }
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / 420)
    box.scrollTop = from + (target() - from) * (1 - Math.pow(1 - k, 3))
    requestAnimationFrame(k < 1 ? step : settle)
  }
  requestAnimationFrame(step)
}

/** The left-hand playlist: every episode in the season, always visible. */
export default function EpisodeList({
  episodes, currentNumber, checked, watchedNumbers, progress, langs, activeLang,
  epLangs, epTitles, downloadedLangs, isFilm, filmLabel = 'Film', season, seasons,
  onSelect, onToggle, onToggleAll, onLang, onToggleWatched, onSelectEpisodeLang,
  seasonLists, onLoadSeason, onPlayOther, watchOf, headerAction,
}: Props) {
  // The list reads as a queue: it opens on the episode playing, with what comes
  // next below it. Only the list scrolls, never the page around it.
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = scroller.current
    const row = box?.querySelector('[aria-current="true"]')
    if (!box || !row) return
    box.scrollTop += row.getBoundingClientRect().top - box.getBoundingClientRect().top - 8
  }, [currentNumber, episodes, season])

  /** Already on disk in the language being shown — nothing left to select. */
  const isDownloaded = (num: number) => (downloadedLangs[num] ?? []).includes(activeLang)

  // Only episodes this language actually serves and hasn't already stored can
  // be downloaded, so they alone decide the select-all state.
  const downloadable = episodes.filter(
    e => Object.keys(e.embed_urls).length > 0 && !isDownloaded(e.number),
  )
  const allChecked = downloadable.length > 0 && downloadable.every(e => checked.has(e.number))
  const someChecked = downloadable.some(e => checked.has(e.number))

  // A language often runs behind: the newest episodes may exist in vostfr only.
  // Those are listed here too — greyed out, playable in one click via their
  // language chip — so the gap is visible without switching language first.
  const listed = new Set(episodes.map(e => e.number))
  const foreign: EpisodeDetail[] = Object.keys(epLangs)
    .map(Number)
    .filter(n => !listed.has(n))
    .map(n => ({
      number: n,
      title: epTitles[n] ?? `Episode ${n}`,
      filename: '',
      providers: [],
      embed_urls: {},
    }))
  const rows = [...episodes, ...foreign].sort((a, b) => a.number - b.number)

  const episodeItems = rows.map((ep, idx) => {
    // A file on disk is a source in its own right: a title opened from the
    // downloaded library has no embeds at all, and every episode of it would
    // otherwise read as unplayable.
    const playable = Object.keys(ep.embed_urls).length > 0 || isDownloaded(ep.number)
    const current = ep.number === currentNumber
    const pct = progress[ep.number]
    const available = epLangs[ep.number] ?? []
    // Listed, but not playable in the active language — either the site
    // said so, or the probe found it in another language only.
    const missingHere = !playable && available.length > 0
    return (
      <li key={ep.number} className="ep-in" style={{ '--i': Math.min(idx, 12) } as CSSProperties}>
        <div
          className={`group flex items-center gap-2 rounded-[10px] px-2 py-2 transition-colors ${
            current ? 'bg-primary/22' : 'hover:bg-base-300/60'
          }`}
        >
          {/* Nothing to download for an episode this language lacks, but
              the box keeps its slot so the rows stay aligned. Once the file is
              on disk the slot becomes a plain mark instead: a state, not a
              control, so it deliberately carries no pressable affordance. */}
          {isDownloaded(ep.number) ? (
            <span
              className="shrink-0 w-5 h-5 flex items-center justify-center text-warning/70"
              title={`Already downloaded in ${activeLang.toUpperCase()}`}
              aria-label={`${ep.title} is already downloaded`}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12.5l2.5 2.5L16 9.5" />
              </svg>
            </span>
          ) : (
            <input
              type="checkbox"
              checked={!missingHere && checked.has(ep.number)}
              disabled={missingHere}
              onChange={() => onToggle(ep.number)}
              aria-label={`Select ${ep.title} for download`}
              title={missingHere ? `Not available in ${activeLang.toUpperCase()}` : undefined}
              className={`checkbox checkbox-primary checkbox-sm shrink-0 ${missingHere ? 'opacity-30' : ''}`}
            />
          )}
          <div className="flex-1 min-w-0">
            <button
              type="button"
              disabled={!playable}
              onClick={() => onSelect(ep)}
              aria-current={current ? 'true' : undefined}
              className={`w-full min-w-0 text-left ${playable ? 'cursor-pointer' : 'cursor-default opacity-50'}`}
              title={
                playable
                  ? 'Play this episode'
                  : missingHere
                    ? `Only in ${(epLangs[ep.number] ?? []).join(', ').toUpperCase()} — use its chip`
                    : 'No source for this episode'
              }
            >
              <div className="flex items-center gap-2">
                {!isFilm && (
                  <span className={`text-xs font-mono shrink-0 ${current ? 'text-primary' : 'text-base-content/40'}`}>
                    {current ? '▶' : 'E'}{String(ep.number).padStart(2, '0')}
                  </span>
                )}
                <span className={`text-sm truncate flex-1 ${current ? 'text-primary' : ''}`}>{ep.title}</span>
                {watchedNumbers.has(ep.number) && (
                  <span className="text-success text-xs shrink-0" title="Watched" aria-label="Watched">✓</span>
                )}
              </div>
              {pct !== undefined && pct > 0 && pct < 1 && (
                <div className="h-0.5 bg-base-300 rounded-full mt-1.5 overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${Math.round(pct * 100)}%` }} />
                </div>
              )}
            </button>
          </div>
          {/* Which versions this episode exists in. A new episode is
              often vostfr before it is vf, so the missing ones stay
              listed — struck through — rather than silently absent. */}
          {langs.length > 1 && available.length > 0 && (
            <div className="flex gap-1 shrink-0">
              {langs.map(l => {
                const has = available.includes(l)
                const on = has && l === activeLang && current
                // Downloaded state rides on each version's own badge: a
                // download is per language, so this is the only place it can
                // be told accurately. Same discreet yellow tick as the row.
                const stored = (downloadedLangs[ep.number] ?? []).includes(l)
                const tick = stored && (
                  <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={4}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )
                if (!has) {
                  return (
                    <span
                      key={l}
                      className={`badge badge-xs font-mono uppercase gap-0.5 ${
                        stored
                          ? 'badge-ghost text-warning/70'
                          : 'badge-ghost opacity-40 line-through'
                      }`}
                      title={stored
                        ? `Downloaded in ${l.toUpperCase()} — no longer listed`
                        : `No ${l.toUpperCase()} version`}
                    >
                      {l}
                      {tick}
                    </span>
                  )
                }
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => onSelectEpisodeLang(ep, l)}
                    aria-pressed={on}
                    title={stored
                      ? `Downloaded in ${l.toUpperCase()} — play it`
                      : `Play in ${l.toUpperCase()}`}
                    className={`badge badge-xs font-mono uppercase cursor-pointer gap-0.5 ${
                      on
                        ? 'badge-primary'
                        : stored
                          ? 'badge-outline text-warning/70 hover:badge-primary'
                          : 'badge-outline hover:badge-primary'
                    }`}
                  >
                    {l}
                    {tick}
                  </button>
                )
              })}
            </div>
          )}
          {/* Visible on touch, hover-revealed only where hover exists.
              Skipped for an episode this language lacks: there is no
              playable item here to mark. */}
          <div className={`shrink-0 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 transition-opacity ${missingHere ? 'hidden' : ''}`}>
            <button
              type="button"
              onClick={() => onToggleWatched(ep)}
              aria-pressed={watchedNumbers.has(ep.number)}
              aria-label={
                watchedNumbers.has(ep.number)
                  ? `Mark ${ep.title} unwatched`
                  : `Mark ${ep.title} watched`
              }
              title={watchedNumbers.has(ep.number) ? 'Watched' : 'Mark watched'}
              className={`btn btn-ghost btn-square btn-sm ${
                watchedNumbers.has(ep.number)
                  ? 'text-success'
                  : 'text-base-content/40 hover:text-success'
              }`}
            >
              {/* Filled circle when watched, outline when not, so the state
                  never rests on colour alone. */}
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill={watchedNumbers.has(ep.number) ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth={2}
              >
                <circle cx="12" cy="12" r="9" />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  stroke={watchedNumbers.has(ep.number) ? 'var(--color-base-100)' : 'currentColor'}
                  d="M8 12.5l2.5 2.5L16 9.5"
                />
              </svg>
            </button>
          </div>
        </div>
      </li>
    )
  })

  // ---- seasons: one accordion, several open at once --------------------------
  const [open, setOpen] = useState<Set<number>>(() => new Set([season]))
  /** The pill under the cursor of the last jump; the playing season until one. */
  const [picked, setPicked] = useState(season)
  // A new playing season opens itself and takes the pill (adjusted during
  // render rather than in an effect, so there is no frame with the old one).
  const [lastSeason, setLastSeason] = useState(season)
  if (lastSeason !== season) {
    setLastSeason(season)
    setPicked(season)
    setOpen(prev => (prev.has(season) ? prev : new Set(prev).add(season)))
  }
  const [flash, setFlash] = useState<number | null>(null)
  const seasonEls = useRef(new Map<number, HTMLElement>())
  const pillEls = useRef(new Map<number, HTMLButtonElement>())
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)
  const multi = seasons.length > 1

  // The sliding pill follows the picked season's button.
  useLayoutEffect(() => {
    const el = pillEls.current.get(picked)
    setPill(el ? { left: el.offsetLeft, width: el.offsetWidth } : null)
  }, [picked, seasons.length])

  // Empty room after the last season, so it too can be scrolled up to the top.
  const [spacer, setSpacer] = useState(0)
  useEffect(() => {
    const box = scroller.current
    const last = seasons.length ? seasonEls.current.get(seasons[seasons.length - 1].season_number) : undefined
    if (!box || !last || !multi) { setSpacer(0); return }
    const measure = () => setSpacer(Math.max(0, box.clientHeight - last.offsetHeight - 8))
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(box)
    watch.observe(last)
    return () => watch.disconnect()
  }, [seasons, multi, open])

  const follow = (n: number) => {
    const box = scroller.current
    const el = seasonEls.current.get(n)
    if (box && el) scrollSeasonIntoView(box, el)
  }

  // A season that was the playing one and has been left still shows open: it
  // is an ordinary other season now, so its episodes are loaded (from cache).
  useEffect(() => {
    for (const n of open) if (n !== season && !seasonLists[n]) onLoadSeason(n)
  }, [open, season, seasonLists, onLoadSeason])

  const ensureOpen = (n: number) => {
    setOpen(prev => (prev.has(n) ? prev : new Set(prev).add(n)))
    if (n !== season) onLoadSeason(n)
  }
  const jump = (n: number) => {
    ensureOpen(n)
    setPicked(n)
    follow(n)
    setFlash(n)
    window.setTimeout(() => setFlash(f => (f === n ? null : f)), 700)
  }
  const toggleSeason = (n: number) => {
    if (open.has(n)) setOpen(prev => { const next = new Set(prev); next.delete(n); return next })
    else ensureOpen(n)
  }

  /** Watched / total for a season, when its episodes are known. */
  const statsOf = (n: number): { watched: number; total: number } | null => {
    if (n === season) {
      return { watched: episodes.filter(e => watchedNumbers.has(e.number)).length, total: episodes.length }
    }
    const list = seasonLists[n]
    if (list?.status !== 'ok') return null
    return { watched: list.episodes.filter(e => watchOf(n, e.number).watched).length, total: list.episodes.length }
  }

  const otherRows = (s: ShowSeason, list: Extract<SeasonList, { status: 'ok' }>) => (
    <ul className="space-y-0.5">
      {list.episodes.map((ep, i) => {
        const w = watchOf(s.season_number, ep.number)
        const playable = Object.keys(ep.embed_urls).length > 0
        return (
          <li key={ep.number} className="ep-in" style={{ '--i': Math.min(i, 12) } as CSSProperties}>
            <button
              type="button"
              disabled={!playable}
              onClick={() => onPlayOther(s, ep)}
              title={playable ? 'Play this episode' : 'No source for this episode'}
              className={`w-full text-left rounded-[10px] px-2 py-2 transition-colors ${
                playable ? 'hover:bg-base-300/60 cursor-pointer' : 'opacity-50 cursor-default'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono shrink-0 text-base-content/40">E{String(ep.number).padStart(2, '0')}</span>
                <span className="text-sm truncate flex-1">{ep.title}</span>
                {w.watched && <span className="text-success text-xs shrink-0" aria-label="Watched">✓</span>}
              </div>
              {w.progress !== undefined && w.progress > 0 && w.progress < 1 && (
                <div className="h-0.5 bg-base-300 rounded-full mt-1.5 overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${Math.round(w.progress * 100)}%` }} />
                </div>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )

  const seasonBody = (s: ShowSeason) => {
    if (s.season_number === season) return <ul className="space-y-0.5">{episodeItems}</ul>
    const list = seasonLists[s.season_number]
    if (!list || list.status === 'loading') {
      return (
        <ul className="space-y-2 py-2" aria-busy="true">
          {[0, 1, 2, 3].map(i => <li key={i} className="h-2.5 w-3/5 rounded bg-base-300 animate-pulse" />)}
        </ul>
      )
    }
    if (list.status === 'error') {
      return (
        <p className="py-2 text-sm text-base-content/60">
          Couldn&apos;t load this season.{' '}
          <button type="button" className="link link-primary" onClick={() => onLoadSeason(s.season_number, true)}>Retry</button>
        </p>
      )
    }
    return otherRows(s, list)
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* List header: what this is, language, then the season pills and select-all */}
      <div className="px-3 py-3 flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">
            {isFilm ? filmLabel : 'Episodes'}
            <span className="text-base-content/45 ml-2 text-xs">
              {rows.length} {rows.length === 1 ? 'item' : 'episodes'}
            </span>
          </p>
          <div className="flex items-center gap-1">
            <LangSwitcher langs={langs} active={activeLang} onSelect={onLang} />
            {headerAction}
          </div>
        </div>
        {multi && (
          <div className="relative flex gap-1 rounded-xl bg-black/22 p-0.75 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Seasons">
            {pill && (
              <span
                aria-hidden="true"
                className="absolute top-0.75 bottom-0.75 left-0 rounded-[9px] bg-primary/24 transition-[translate,width] duration-300 ease-smooth motion-reduce:transition-none"
                style={{ width: pill.width, translate: `${pill.left}px 0` }}
              />
            )}
            {seasons.map(s => {
              const st = statsOf(s.season_number)
              return (
                <button
                  key={s.season_number}
                  ref={el => { if (el) pillEls.current.set(s.season_number, el); else pillEls.current.delete(s.season_number) }}
                  type="button"
                  role="tab"
                  aria-selected={picked === s.season_number}
                  onClick={() => jump(s.season_number)}
                  className={`relative flex-1 min-w-10 flex flex-col items-center gap-1 rounded-[9px] px-2 pt-1.5 pb-1.5 text-xs font-semibold ${
                    s.season_number === season ? 'text-primary' : 'text-base-content/70 hover:text-base-content'
                  }`}
                >
                  S{s.season_number}
                  <span className="block w-3/5 h-0.75 rounded-full bg-white/10 overflow-hidden">
                    <span
                      className="block h-full bg-success transition-[width] duration-300 ease-smooth"
                      style={{ width: st && st.total ? `${(st.watched / st.total) * 100}%` : 0 }}
                    />
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <label className="flex items-center gap-2 text-xs text-base-content/60 cursor-pointer">
          <input
            type="checkbox"
            checked={allChecked}
            ref={el => { if (el) el.indeterminate = !allChecked && someChecked }}
            onChange={onToggleAll}
            className="checkbox checkbox-primary checkbox-sm"
          />
          Select all for download
        </label>
      </div>
      {/* Episodes. With several seasons each is a fold: opening one loads it in
          place, and a pill above scrolls it into view. */}
      <div ref={scroller} className="relative overflow-y-auto flex-1 min-h-0 px-2 pb-2">
        {!multi ? (
          <ul className="space-y-0.5">{episodeItems}</ul>
        ) : (
          <>
            {seasons.map(s => {
              const n = s.season_number
              const isOpen = open.has(n)
              const st = statsOf(n)
              return (
                <div
                  key={n}
                  ref={el => { if (el) seasonEls.current.set(n, el); else seasonEls.current.delete(n) }}
                  className="mb-1"
                >
                  <button
                    type="button"
                    onClick={() => toggleSeason(n)}
                    aria-expanded={isOpen}
                    className={`sticky top-0 z-1 w-full flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm text-left transition-colors duration-300 ${
                      flash === n ? 'bg-primary/30' : isOpen ? 'bg-base-300' : 'bg-base-200 hover:bg-base-300'
                    }`}
                  >
                    <svg
                      className={`w-3.5 h-3.5 shrink-0 text-base-content/60 transition-transform duration-300 ease-smooth motion-reduce:transition-none ${isOpen ? 'rotate-90' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="font-semibold">Season {n}</span>
                    {st && <span className="text-xs text-base-content/55">{st.total} ep</span>}
                    <span className="ml-auto flex items-center gap-2">
                      {n === season ? (
                        <span className="rounded-md bg-primary/22 text-primary text-[10px] font-bold px-1.5 py-0.5">PLAYING</span>
                      ) : st ? (
                        <span className="text-xs text-base-content/55">{st.watched}/{st.total}</span>
                      ) : null}
                      <span className="w-11 h-1 rounded-full bg-white/10 overflow-hidden">
                        <span
                          className="block h-full bg-success transition-[width] duration-300 ease-smooth"
                          style={{ width: st && st.total ? `${(st.watched / st.total) * 100}%` : 0 }}
                        />
                      </span>
                    </span>
                  </button>
                  <div
                    inert={!isOpen}
                    className={`grid transition-[grid-template-rows] duration-[280ms] ease-smooth motion-reduce:transition-none ${
                      isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                    }`}
                  >
                    <div className="overflow-hidden min-h-0">
                      <div className="mt-1 mb-1.5 ml-2.5 pl-1.5 border-l border-base-content/10">{seasonBody(s)}</div>
                    </div>
                  </div>
                </div>
              )
            })}
            <div aria-hidden="true" style={{ height: spacer }} />
          </>
        )}
      </div>
    </div>
  )
}
