import { useRef } from 'react'
import type { SeasonCard, VideoInfo } from '../api'
import { videoSeasonCard, warmVideo } from '../api'
import { videoMeta } from '../videoLinks'
import { useWatchState, watchKey } from '../watchState'
import { VideoThumb } from './search/LinkCard'

interface Props {
  videos: VideoInfo[]
  onOpen: (card: SeasonCard) => void
  /** Name each video's channel: off on a channel's own page, where it is all one. */
  showChannel?: boolean
}

/** YouTube and Twitch videos with their watch progress: a grid on desktop,
 *  rows with the thumbnail on the left on phones. */
export default function VideoGrid({ videos, onOpen, showChannel = false }: Props) {
  const watch = useWatchState()
  const rest = useRef<ReturnType<typeof setTimeout>>(undefined)
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-x-4 sm:gap-y-6">
      {videos.map(v => {
        const entry = watch[watchKey(v.title, 0, 1)]
        const fraction = entry ? (entry.watched ? 1 : entry.duration ? entry.position / entry.duration : 0) : 0
        return (
          <li key={v.page_url}>
            <button
              type="button"
              onClick={() => onOpen(videoSeasonCard(v))}
              // Only a pointer that rests: sweeping across the grid must not look
              // every tile up (YouTube rate-limits an IP that asks too much).
              onPointerEnter={() => { clearTimeout(rest.current); rest.current = setTimeout(() => warmVideo(v.page_url), 400) }}
              onPointerLeave={() => clearTimeout(rest.current)}
              className="group flex sm:flex-col gap-3 sm:gap-2 w-full text-left rounded-box focus-visible:outline-2 focus-visible:outline-primary"
            >
              <div className="relative w-40 sm:w-full shrink-0">
                <VideoThumb info={v} className="w-full transition-opacity group-hover:opacity-90" />
                {fraction > 0 && (
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50 rounded-b-box overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${Math.min(100, fraction * 100)}%` }} />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug line-clamp-2">{v.title}</p>
                <p className="mt-0.5 text-xs text-base-content/50">
                  {[videoMeta(showChannel ? v : { ...v, channel: '' }), entry?.watched ? 'Watched' : null].filter(Boolean).join(' · ')}
                </p>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
