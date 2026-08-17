import type { EpisodeDetail } from '../../api'
import type { ShowSeason } from '../../useShowSeasons'
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
  season: number
  /** Every season of this show on this site, empty when there is only one. */
  seasons: ShowSeason[]
  /** Open another season's playlist. */
  onSelectSeason: (season: ShowSeason) => void
  onSelect: (ep: EpisodeDetail) => void
  onToggle: (num: number) => void
  onToggleAll: () => void
  onLang: (lang: string) => void
  /** Flip an episode's watched flag. Owned by the parent, which holds the playlist. */
  onToggleWatched: (ep: EpisodeDetail) => void
}

/** The left-hand playlist: every episode in the season, always visible. */
export default function EpisodeList({
  episodes, currentNumber, checked, watchedNumbers, progress, langs, activeLang,
  epLangs, epTitles, downloadedLangs, isFilm, season, seasons,
  onSelect, onToggle, onToggleAll, onLang, onToggleWatched, onSelectEpisodeLang,
  onSelectSeason,
}: Props) {
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

  const episodeItems = rows.map(ep => {
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
      <li key={ep.number}>
        <div
          className={`group flex items-center gap-2 rounded-box px-2 py-2 transition-colors ${
            current ? 'bg-primary/15 ring-1 ring-primary/40' : 'hover:bg-base-300/60'
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
                    ? `Only in ${(epLangs[ep.number] ?? []).join(', ').toUpperCase()} — use the chip below`
                    : 'No source for this episode'
              }
            >
              <div className="flex items-center gap-2">
                {!isFilm && (
                  <span className={`text-xs font-mono shrink-0 ${current ? 'text-primary' : 'text-base-content/40'}`}>
                    {current ? '▶' : 'E'}{String(ep.number).padStart(2, '0')}
                  </span>
                )}
                <span className="text-sm truncate flex-1">{ep.title}</span>
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
            {/* Which versions this episode exists in. A new episode is
                often vostfr before it is vf, so the missing ones stay
                listed — struck through — rather than silently absent. */}
            {langs.length > 1 && available.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
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
          </div>
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

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* List header: season, language, select-all */}
      <div className="px-3 py-3 border-b border-base-300 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">
            {isFilm
              ? 'Film'
              : seasons.length > 1
                ? `${seasons.length} seasons`
                : `Season ${season}`}
            <span className="text-base-content/40 ml-2 text-xs">
              {rows.length} {rows.length === 1 ? 'item' : 'episodes'}
            </span>
          </p>
          <LangSwitcher langs={langs} active={activeLang} onSelect={onLang} />
        </div>
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
      {/* Episodes, under their season when the show has more than one. Only
          the open season is expanded: the others are links, since loading them
          all would fetch a page per season for a list nobody asked to see. */}
      <div className="overflow-y-auto flex-1 min-h-0 p-2">
        {seasons.length === 0 ? (
          <ul className="space-y-1">{episodeItems}</ul>
        ) : (
          seasons.map(s => (
            <div key={s.season_number} className="mb-1">
              <button
                type="button"
                onClick={() => { if (!s.current) onSelectSeason(s) }}
                aria-expanded={s.current}
                className={`w-full flex items-center gap-2 rounded-box px-2 py-1.5 text-sm text-left transition-colors ${
                  s.current
                    ? 'font-medium bg-base-300/40'
                    : 'text-base-content/60 hover:bg-base-300/60 cursor-pointer'
                }`}
              >
                <span className="text-xs font-mono w-3 shrink-0" aria-hidden="true">
                  {s.current ? '▾' : '▸'}
                </span>
                Season {s.season_number}
              </button>
              {s.current && (
                <ul className="space-y-1 mt-1 ml-2 pl-1 border-l border-base-300">
                  {episodeItems}
                </ul>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
