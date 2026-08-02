import type { EpisodeDetail } from '../../api'
import SaveToggles from '../SaveToggles'
import EpisodeRowActions from './EpisodeRowActions'

interface Props {
  ep: EpisodeDetail
  checked: boolean
  onToggle: () => void
  onPlay: () => void
  onCast: () => void
  pageUrl: string
  // Identity for saving this episode to a list.
  seriesName: string
  season: number
  posterUrl: string
  lang: string
  /** Series rows show the E## number; film rows show only the title. */
  showNumber: boolean
  /** Marks the episode as already watched (from the watch-state store). */
  watched?: boolean
}

/** One selectable, playable episode row (series and film variants). */
export default function EpisodeRow({
  ep, checked, onToggle, onPlay, onCast, pageUrl, showNumber, watched,
  seriesName, season, posterUrl, lang,
}: Props) {
  const hasProviders = Object.keys(ep.embed_urls).length > 0
  return (
    <div className="flex items-center gap-2 sm:gap-3 hover:bg-base-300 rounded-lg px-2 sm:px-3 py-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={showNumber ? `Select episode ${ep.number}` : `Select ${ep.title}`}
        className="checkbox checkbox-primary shrink-0 cursor-pointer"
      />
      <button
        type="button"
        className={`flex items-center gap-3 flex-1 min-w-0 text-left ${hasProviders ? 'cursor-pointer' : 'cursor-default'}`}
        disabled={!hasProviders}
        onClick={onPlay}
        title={hasProviders ? 'Play in browser' : undefined}
        aria-label={hasProviders ? (showNumber ? `Play episode ${ep.number} — ${ep.title}` : `Play ${ep.title}`) : undefined}
      >
        {showNumber && (
          <span className="text-base-content/50 text-xs sm:text-sm font-mono w-8 shrink-0">
            E{String(ep.number).padStart(2, '0')}
          </span>
        )}
        <span className={`text-sm sm:text-base flex-1 truncate ${showNumber ? '' : 'font-medium'}`}>{ep.title}</span>
        {watched && (
          <span className="badge badge-success badge-sm gap-1 shrink-0" title="Watched">
            ✓<span className="hidden sm:inline">Watched</span>
          </span>
        )}
      </button>
      <SaveToggles
        size="sm"
        entry={{
          kind: 'episode',
          series: seriesName,
          season,
          number: ep.number,
          label: ep.title,
          poster_url: posterUrl,
          page_url: pageUrl,
          lang,
        }}
      />
      <EpisodeRowActions hasProviders={hasProviders} pageUrl={pageUrl} onPlay={onPlay} onCast={onCast} />
    </div>
  )
}
