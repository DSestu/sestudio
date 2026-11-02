import type { CSSProperties } from 'react'
import { minutesLeft } from '../../rowItems'
import type { WatchingItem } from '../../watchState'
import { episodeLabel, watchingContext } from '../library/watchingLabels'
import { VersionChip } from './PosterStrip'
import Widget from './Widget'

/** Compact rows under the lead item. */
const ROWS = 3

const fraction = (item: WatchingItem) =>
  item.resume.position > 0 && item.resume.duration > 0 ? item.resume.position / item.resume.duration : 0

const isVideo = (item: WatchingItem) => item.source === 'youtube' || item.source === 'twitch'

/** The item's picture. Some saved videos have no thumbnail; a YouTube one can
 *  always be rebuilt from its watch URL. */
function artFor(item: WatchingItem): string {
  if (item.poster_url) return item.poster_url
  const id = item.source === 'youtube' && item.page_url.match(/[?&]v=([\w-]{6,})|youtu\.be\/([\w-]{6,})/)
  return id ? `https://i.ytimg.com/vi/${id[1] ?? id[2]}/hqdefault.jpg` : ''
}

/** "12 min left" for a started episode, "Up next" for one not begun. */
function timeLeft(item: WatchingItem) {
  return fraction(item) ? minutesLeft(item.resume.position, item.resume.duration) : 'Up next'
}

const playIcon = <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>

interface Props {
  items: WatchingItem[]
  /** Open the series at its resume episode. */
  onOpen: (item: WatchingItem) => void
  /** The full list, in the Library. */
  onSeeAll: () => void
  style?: CSSProperties
}

/** Continue watching (L): the lead series as a hero over its blurred poster,
 *  then a few compact rows. The frame's top edge is the lead's timeline. */
export default function ContinueWidget({ items, onOpen, onSeeAll, style }: Props) {
  const [lead, ...rest] = items
  const started = fraction(lead) > 0
  const leadArt = artFor(lead)

  return (
    <Widget
      size="L"
      title="Continue watching"
      count={items.length}
      onOpen={onSeeAll}
      frame="f-continue"
      // A phone shows it alone: the lead is 3 rows, each row under it adds about one.
      phoneRows={rest.length === 0 ? 3 : rest.length === 1 ? 4 : 5}
      style={{ ...style, '--p': `${Math.round(fraction(lead) * 100)}%` } as CSSProperties}
    >
      {/* The show's own light behind the header and hero, fading into the panel. */}
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-56 -z-10 overflow-hidden">
        {leadArt && (
          <div className="absolute -inset-5 bg-cover bg-center blur-[20px] saturate-[1.2] opacity-50 scale-110" style={{ backgroundImage: `url("${leadArt}")` }} />
        )}
        <div className="absolute inset-0 bg-linear-to-b from-transparent from-20% to-base-200 to-92%" />
      </div>

      <div className="flex items-end gap-3 mt-3">
        {/* Videos keep their 16:9 frame; posters are 2:3. */}
        <button type="button" onClick={() => onOpen(lead)} className={`${isVideo(lead) ? 'w-[160px]' : 'w-[100px]'} shrink-0 rounded-box overflow-hidden ring-1 ring-base-content/10 bg-base-300`} aria-label={`Open ${lead.series}`}>
          {leadArt && <img src={leadArt} alt="" className={`w-full ${isVideo(lead) ? 'aspect-video' : 'aspect-[2/3]'} object-cover`} />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xl font-semibold tracking-tight leading-tight line-clamp-2">{lead.series}</p>
          {/* A film or video's "episode" is often its own title again. */}
          {watchingContext(lead) !== lead.series && (
            <p className="mt-1 text-xs text-base-content/50 truncate">{watchingContext(lead)}</p>
          )}
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-base-content/70">
            {lead.lang && <VersionChip lang={lead.lang} />}
            {timeLeft(lead)}
          </p>
          <button type="button" onClick={() => onOpen(lead)} className="btn btn-primary btn-sm gap-1.5 mt-2.5">
            {playIcon}
            {started ? 'Resume' : 'Play'}
          </button>
        </div>
      </div>

      {rest.length > 0 && (
        <ul className="mt-auto flex flex-col gap-1 pt-3">
          {rest.slice(0, ROWS).map(item => (
            <li key={`${item.series}|S${item.season}`}>
              <button type="button" onClick={() => onOpen(item)} className="group flex w-full items-center gap-2.5 rounded-field p-1 text-left hover:bg-base-content/5">
                <span className={`${isVideo(item) ? 'w-[60px]' : 'w-[34px]'} shrink-0 rounded-[4px] overflow-hidden bg-base-300`}>
                  {artFor(item) && <img src={artFor(item)} alt="" loading="lazy" className={`w-full ${isVideo(item) ? 'aspect-video' : 'aspect-[2/3]'} object-cover`} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate">{item.series}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-base-content/50 min-w-0">
                    {item.lang && <VersionChip lang={item.lang} />}
                    <span className="truncate">
                      {[item.season > 0 && episodeLabel(item.season, item.resume.number), timeLeft(item)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="mt-1.5 block h-[3px] rounded-full bg-base-content/12 overflow-hidden">
                    <span className="block h-full bg-primary" style={{ width: `${Math.round(fraction(item) * 100)}%` }} />
                  </span>
                </span>
                <span className="btn btn-circle btn-primary btn-sm shrink-0" aria-hidden="true">{playIcon}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  )
}
