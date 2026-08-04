import type { EpisodeDetail } from '../../api'
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
  isFilm: boolean
  season: number
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
  isFilm, season,
  onSelect, onToggle, onToggleAll, onLang, onToggleWatched,
}: Props) {
  const allChecked = episodes.length > 0 && episodes.every(e => checked.has(e.number))
  const someChecked = episodes.some(e => checked.has(e.number))

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* List header: season, language, select-all */}
      <div className="px-3 py-3 border-b border-base-300 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">
            {isFilm ? 'Film' : `Season ${season}`}
            <span className="text-base-content/40 ml-2 text-xs">
              {episodes.length} {episodes.length === 1 ? 'item' : 'episodes'}
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

      {/* Episodes */}
      <ul className="overflow-y-auto flex-1 min-h-0 p-2 space-y-1">
        {episodes.map(ep => {
          const playable = Object.keys(ep.embed_urls).length > 0
          const current = ep.number === currentNumber
          const pct = progress[ep.number]
          return (
            <li key={ep.number}>
              <div
                className={`group flex items-center gap-2 rounded-box px-2 py-2 transition-colors ${
                  current ? 'bg-primary/15 ring-1 ring-primary/40' : 'hover:bg-base-300/60'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked.has(ep.number)}
                  onChange={() => onToggle(ep.number)}
                  aria-label={`Select ${ep.title} for download`}
                  className="checkbox checkbox-primary checkbox-sm shrink-0"
                />
                <button
                  type="button"
                  disabled={!playable}
                  onClick={() => onSelect(ep)}
                  aria-current={current ? 'true' : undefined}
                  className={`flex-1 min-w-0 text-left ${playable ? 'cursor-pointer' : 'cursor-default opacity-50'}`}
                  title={playable ? 'Play this episode' : 'No source for this episode'}
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
                {/* Visible on touch, hover-revealed only where hover exists. */}
                <div className="shrink-0 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
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
        })}
      </ul>
    </div>
  )
}
