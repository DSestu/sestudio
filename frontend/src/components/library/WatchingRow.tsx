import type { PlayableEpisode } from '../../providers'
import { minutesLeft, relativeTime } from '../../rowItems'
import { setWatched, type WatchingItem } from '../../watchState'
import DetailRow from './DetailRow'
import WatchingOverflow from './WatchingOverflow'
import { episodeLabel, watchingContext } from './watchingLabels'

interface Props {
  item: WatchingItem
  /** Open the series, deep-linked to the resume episode. */
  onOpen: (item: WatchingItem) => void
  /** When set, the row selects instead of opening. */
  selection?: { selected: boolean; onToggle: () => void }
}

/** The resume episode as a playable, so watch-state writes can key off it. */
function playableFor(item: WatchingItem): PlayableEpisode {
  return {
    number: item.resume.number,
    title: item.resume.title,
    embed_urls: {},
    series_name: item.series,
    season: item.season,
    poster_url: item.poster_url,
    page_url: item.page_url,
    lang: item.lang,
  }
}

/** One series in the Watching list, with its resume target and context. */
export default function WatchingRow({ item, onOpen, selection }: Props) {
  const started = item.resume.position > 0 && item.resume.duration > 0
  const context = watchingContext(item)

  const watchedOf = item.seasonEpisodes
    ? `${item.watchedCount} of ${item.seasonEpisodes} watched`
    : item.watchedCount > 0
      ? `${item.watchedCount} watched`
      : null

  return (
    <DetailRow
      poster_url={item.poster_url}
      title={item.series}
      meta={context}
      submeta={[watchedOf, relativeTime(item.updatedAt)].filter(Boolean).join(' · ')}
      // A not-yet-started episode has no progress to draw.
      progress={
        started
          ? {
              fraction: item.resume.position / item.resume.duration,
              label: minutesLeft(item.resume.position, item.resume.duration),
            }
          : undefined
      }
      onOpen={() => onOpen(item)}
      selection={selection}
      overflow={<WatchingOverflow item={item} context={context} onOpen={onOpen} />}
      actions={
        <>
          <button onClick={() => onOpen(item)} className="btn btn-primary btn-sm gap-1.5">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            {started ? 'Resume' : 'Play'}
          </button>
          <button
            onClick={() => setWatched(playableFor(item), true)}
            // The label collapses to its icon on a phone, where the row is narrow.
            aria-label={`Mark ${episodeLabel(item.season, item.resume.number)} watched`}
            title="Mark watched"
            className="btn btn-ghost btn-sm gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="hidden sm:inline">Mark watched</span>
          </button>
        </>
      }
    />
  )
}
