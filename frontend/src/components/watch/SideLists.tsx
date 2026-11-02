import type { TrendingCard, VideoInfo } from '../../api'
import { timeAgo } from '../../notifications'

/** Titles like this one, beside a film's player. */
export function SimilarTitles({ items, onOpen }: { items: TrendingCard[]; onOpen: (title: string) => void }) {
  return (
    <>
      <p className="text-[13px] font-semibold">Similar titles</p>
      <div className="grid grid-cols-2 gap-2.5">
        {items.slice(0, 6).map(r => (
          <button
            key={`${r.kind}-${r.tmdb_id}`}
            type="button"
            onClick={() => onOpen(r.title)}
            className="text-left group"
          >
            {r.poster_url ? (
              <img src={r.poster_url} alt="" loading="lazy" className="w-full aspect-2/3 rounded-md object-cover bg-base-300" />
            ) : (
              <div className="w-full aspect-2/3 rounded-md bg-base-300" />
            )}
            <p className="mt-1 text-xs truncate group-hover:text-primary">{r.title}</p>
          </button>
        ))}
      </div>
    </>
  )
}

/** More from the channel a video belongs to, beside (or under) its player. */
export function ChannelVideos({ channel, channelLink, videos, onOpen }: {
  channel: string
  channelLink: string
  videos: VideoInfo[]
  onOpen: (v: VideoInfo) => void
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <p className="flex-1 min-w-0 truncate text-[13px] font-semibold">More from {channel}</p>
        <a href={channelLink} className="text-xs text-base-content/55 hover:text-base-content shrink-0">See all ›</a>
      </div>
      <ul className="flex flex-col gap-2.5">
        {videos.map(v => (
          <li key={v.page_url}>
            <button type="button" onClick={() => onOpen(v)} className="flex gap-2.5 items-start text-left w-full group">
              {v.thumbnail ? (
                <img src={v.thumbnail} alt="" loading="lazy" className="w-30 aspect-video rounded-md object-cover shrink-0 bg-base-300" />
              ) : (
                <div className="w-30 aspect-video rounded-md shrink-0 bg-base-300" />
              )}
              <span className="min-w-0 text-xs leading-snug">
                <span className="block line-clamp-2 group-hover:text-primary">{v.title}</span>
                {v.timestamp > 0 && <span className="text-[11px] text-base-content/45">{timeAgo(v.timestamp)}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
