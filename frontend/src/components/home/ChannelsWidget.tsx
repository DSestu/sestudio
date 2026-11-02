import type { CSSProperties } from 'react'
import type { SeasonCard } from '../../api'
import { videoSeasonCard } from '../../api'
import type { ChannelsSummary } from '../../homeChannels'
import { timeAgo } from '../../notifications'
import { useWatchers } from '../../watchers'
import { VideoThumb } from '../search/LinkCard'
import Widget from './Widget'

/** Videos the strip holds; the creators view has the rest. */
const LIMIT = 12

interface Props {
  summary: ChannelsSummary
  style?: CSSProperties
  onPlay: (card: SeasonCard) => void
  onSeeAll: () => void
}

/** The latest videos of the channels you follow, led by who they come from. */
export default function ChannelsWidget({ summary, style, onPlay, onSeeAll }: Props) {
  const avatars = new Map(
    useWatchers()
      .filter(w => w.kind === 'channel')
      .map(w => [String(w.config.channel_url ?? ''), String(w.config.avatar ?? '')]),
  )
  const calm = !summary.fresh
  return (
    <Widget
      style={style}
      size="M"
      title="From your channels"
      sub={calm ? 'latest' : undefined}
      badge={summary.fresh}
      onOpen={onSeeAll}
      // Who it comes from comes first; desaturated when nothing is new.
      icon={
        <span className={`flex shrink-0 pl-1.5 ${calm ? 'saturate-60 opacity-80' : ''}`} aria-hidden="true">
          {summary.faces.map(url => avatars.get(url)
            ? <img key={url} src={avatars.get(url)} alt="" className="-ml-1.5 w-5 h-5 rounded-full object-cover outline-2 outline-base-200" />
            : <span key={url} className="-ml-1.5 w-5 h-5 rounded-full bg-base-300 outline-2 outline-base-200" />)}
        </span>
      }
      frame="f-chan"
    >
      <div className="flex gap-2.5 overflow-x-auto no-scrollbar snap-x">
        {summary.videos.slice(0, LIMIT).map(v => (
          <button key={v.page_url} type="button" onClick={() => onPlay(videoSeasonCard(v))} className="group w-[172px] shrink-0 snap-start text-left">
            <VideoThumb info={v} className="w-full ring-1 ring-base-300 group-hover:ring-primary/70 transition" />
            <p className="mt-1.5 text-xs font-medium leading-tight line-clamp-2">{v.title}</p>
            <p className="mt-0.5 text-[11px] text-base-content/50 truncate">
              {[v.channel, v.timestamp ? timeAgo(v.timestamp) : null].filter(Boolean).join(' · ')}
            </p>
          </button>
        ))}
      </div>
    </Widget>
  )
}
