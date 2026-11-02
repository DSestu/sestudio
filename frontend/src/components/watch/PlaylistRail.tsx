import type { CSSProperties } from 'react'
import type { EpisodeDetail } from '../../api'
import type { SeasonList } from '../../useSeasonLists'
import type { ShowSeason } from '../../useShowSeasons'

interface Props {
  /** The page's own season, whose episodes are `episodes`. */
  season: number
  episodes: EpisodeDetail[]
  /** Every season of the show; empty when there is only one. */
  seasons: ShowSeason[]
  seasonLists: Record<number, SeasonList>
  currentNumber: number | null
  nextLabel: string | null
  watchOf: (season: number, episode: number) => { watched: boolean; progress?: number }
  onPlay: (ep: EpisodeDetail) => void
  onPlayOther: (season: ShowSeason, ep: EpisodeDetail) => void
  onNext: () => void
  /** Open the list (the Episodes item, or a tap on touch). */
  onOpen: () => void
  /** Hidden while the sheet is open over it, or pinned. */
  hidden: boolean
  /** The pinned column is where the sheet slides to, so the rail leaves that way. */
  leaving: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The collapsed playlist (docs/SPEC-watch-page.md, C): a glass rail, the twin of
 * the nav rail. What is playing, what is next, and a square per episode.
 */
export default function PlaylistRail({
  season, episodes, seasons, seasonLists, currentNumber, nextLabel, watchOf, onPlay, onPlayOther,
  onNext, onOpen, hidden, leaving,
}: Props) {
  const groups = (seasons.length > 1 ? seasons : [{ season_number: season, page_url: '', source: '', current: true }]).map(s => ({
    s,
    list: s.season_number === season ? episodes : (seasonLists[s.season_number]?.status === 'ok'
      ? (seasonLists[s.season_number] as Extract<SeasonList, { status: 'ok' }>).episodes
      : null),
  }))
  const square = (s: ShowSeason, ep: EpisodeDetail) => {
    const here = s.season_number === season
    const playing = here && ep.number === currentNumber
    const w = watchOf(s.season_number, ep.number)
    const started = !w.watched && w.progress !== undefined && w.progress > 0 && w.progress < 1
    const style: CSSProperties | undefined = started
      ? { background: `linear-gradient(90deg, color-mix(in oklch, var(--color-primary) 70%, transparent) ${Math.round(w.progress! * 100)}%, rgb(255 255 255 / .07) ${Math.round(w.progress! * 100)}%)` }
      : undefined
    return (
      <button
        key={ep.number}
        type="button"
        title={`S${pad(s.season_number)}E${pad(ep.number)} · ${ep.title}`}
        aria-label={`Play ${ep.title}`}
        aria-current={playing ? 'true' : undefined}
        onClick={() => (here ? onPlay(ep) : onPlayOther(s, ep))}
        style={style}
        className={`w-3.25 h-3.25 rounded-[4px] transition-transform hover:scale-125 ${
          playing ? 'bg-primary ring-2 ring-primary/35' : w.watched ? 'bg-success/65' : started ? '' : 'bg-white/7'
        }`}
      />
    )
  }
  return (
    <div
      inert={hidden}
      className={`absolute inset-y-0 right-0 w-21 glass rounded-2xl flex flex-col items-center gap-2 px-1.75 py-2.5 transition-[opacity,translate] duration-200 ease-smooth motion-reduce:transition-opacity ${
        hidden ? `opacity-0 pointer-events-none ${leaving ? '-translate-x-4' : ''}` : ''
      }`}
    >
      <button
        type="button"
        data-rail-open
        onClick={onOpen}
        className="flex flex-col items-center gap-1 w-18 py-1 text-[11px] font-medium text-base-content/65 hover:text-base-content transition-colors"
      >
        <span className="grid place-items-center w-13 h-8 rounded-[10px]">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
            <path d="M9 6h11M9 12h11M9 18h11" />
            <circle cx="4.5" cy="6" r="1" fill="currentColor" />
            <circle cx="4.5" cy="12" r="1" fill="currentColor" />
            <circle cx="4.5" cy="18" r="1" fill="currentColor" />
          </svg>
        </span>
        Episodes
      </button>
      {currentNumber !== null && (
        <div className="w-full text-center rounded-[10px] bg-primary/22 py-1.5">
          <span className="block text-[10px] opacity-70">Playing</span>
          <b className="block text-[13px] text-primary">{`S${season} · E${pad(currentNumber)}`}</b>
        </div>
      )}
      {nextLabel && (
        <button
          type="button"
          onClick={onNext}
          className="w-full flex flex-col items-center gap-0.5 rounded-[10px] bg-white/6 py-1.5 text-xs font-semibold transition-transform active:scale-92"
        >
          ▶ Next
          <span className="text-[10px] font-normal opacity-60">{nextLabel}</span>
        </button>
      )}
      <div className="flex-1 min-h-0 w-full overflow-y-auto [scrollbar-width:none] flex flex-col gap-2 pt-1">
        {groups.map(({ s, list }) => (
          <div key={s.season_number}>
            <p className="mb-1 text-center text-[10px] font-bold text-base-content/55">S{s.season_number}</p>
            {list ? (
              <div className="grid grid-cols-4 gap-1 justify-center justify-items-center">{list.map(ep => square(s, ep))}</div>
            ) : (
              <p className="text-center text-[10px] text-base-content/40">—</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
