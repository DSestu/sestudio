import type { CSSProperties } from 'react'
import type { WatcherEvent } from '../../api'
import { dayLabel, timeAgo } from '../../notifications'
import { VersionChip } from './PosterStrip'
import Widget from './Widget'

const series = (e: WatcherEvent) => e.data.series_name || e.title

/** "S2·E50 · episode title": the episode when there is one, else what the
 *  watcher said ("VF now available"). */
function what(e: WatcherEvent): string {
  const episode = e.data.number && !e.data.is_film ? `S${e.data.season ?? 1}·E${e.data.number}` : e.subtitle
  return [episode, e.title !== series(e) && e.title].filter(Boolean).join(' · ')
}

const poster = (e: WatcherEvent, className: string) => e.poster_url
  ? <img src={e.poster_url} alt="" loading="lazy" className={`${className} shrink-0 aspect-[2/3] rounded-[4px] object-cover bg-base-300`} />
  : <span className={`${className} shrink-0 aspect-[2/3] rounded-[4px] bg-base-300`} />

const playIcon = <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>

interface Props {
  /** From newFindings: unseen when Home showed them, newest first. */
  items: WatcherEvent[]
  /** Unseen findings in all, for the header badge. */
  unseen: number
  /** Opens the event and marks it seen, as the Activity feed does. */
  onOpen: (event: WatcherEvent) => void
  /** The Activity feed. */
  onSeeAll: () => void
  style?: CSSProperties
}

/** New episodes (M): watcher findings, unopened ones raised like unopened
 *  mail, opened ones sunk to 50%. One finding fills the widget as one block. */
export default function NewEpisodesWidget({ items, unseen, onOpen, onSeeAll, style }: Props) {
  const raised = (e: WatcherEvent) => (e.read_at === null ? 'bg-base-300/80' : 'opacity-50')

  if (items.length === 1) {
    const [e] = items
    const day = dayLabel(e.created_at)
    return (
      <Widget size="M" title="New episodes" badge={unseen} onOpen={onSeeAll} frame="f-new" style={style}>
        <div className={`flex flex-1 min-h-0 gap-3 rounded-[6px] p-2 ${raised(e)}`}>
          {poster(e, 'h-full')}
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="text-lg font-semibold tracking-tight leading-tight line-clamp-2">{series(e)}</p>
            <p className="mt-1 text-xs text-base-content/60 line-clamp-2">{what(e)}</p>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-base-content/70">
              <VersionChip lang={e.data.lang} />
              arrived {day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day}
            </p>
            <button type="button" onClick={() => onOpen(e)} className="btn btn-primary btn-sm gap-1.5 mt-auto self-start">
              {playIcon}
              Play
            </button>
          </div>
        </div>
      </Widget>
    )
  }

  return (
    <Widget size="M" title="New episodes" badge={unseen} onOpen={onSeeAll} frame="f-new" style={style}>
      <ul className="flex flex-col gap-1">
        {items.map(e => (
          <li key={e.id} className="-mx-2">
            <button type="button" onClick={() => onOpen(e)} className={`flex w-full items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left hover:bg-base-content/5 ${raised(e)}`}>
              {poster(e, 'w-[30px]')}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium truncate">{series(e)}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-base-content/50 min-w-0">
                  <VersionChip lang={e.data.lang} />
                  <span className="truncate">{[what(e), timeAgo(e.created_at)].join(' · ')}</span>
                </span>
              </span>
              <span className="btn btn-circle btn-primary btn-sm shrink-0" aria-hidden="true">{playIcon}</span>
            </button>
          </li>
        ))}
      </ul>
    </Widget>
  )
}
