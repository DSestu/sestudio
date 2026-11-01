import type { SeasonCard } from '../api'
import { videoSeasonCard } from '../api'
import { useLive } from '../liveNow'
import { useWatchers } from '../watchers'

/**
 * Followed channels live now, as a row of avatars ringed in red, ending on a
 * way to follow more. Hidden when nobody is on, so it costs Home nothing the
 * rest of the time.
 */
export default function LiveNow({ onOpen, followLink = true }: {
  onOpen: (card: SeasonCard) => void
  /** End on a way to the Creators page; off on that page itself. */
  followLink?: boolean
}) {
  const follows = useWatchers().filter(w => w.kind === 'channel').length
  const live = useLive(follows)

  if (!live.length) return null
  return (
    <section aria-labelledby="live-now">
      <h2 id="live-now" className="text-lg font-semibold tracking-tight mb-3">Live now</h2>
      <ul className="flex gap-4 overflow-x-auto pb-1 -mx-1 px-1">
        {live.map(s => (
          <li key={s.page_url} className="shrink-0">
            <button
              type="button"
              onClick={() => onOpen(videoSeasonCard(s))}
              title={s.title}
              className="flex w-20 flex-col items-center gap-1.5 text-center rounded-box focus-visible:outline-2 focus-visible:outline-primary"
            >
              <span className="rounded-full bg-error p-0.5">
                {s.avatar
                  ? <img src={s.avatar} alt="" className="h-16 w-16 rounded-full border-2 border-base-100 object-cover" />
                  : <span className="block h-16 w-16 rounded-full border-2 border-base-100 bg-base-300" />}
              </span>
              <span className="w-full truncate text-xs font-medium">{s.channel}</span>
              <span className="w-full truncate text-[11px] text-base-content/50">{s.game || 'Live'}</span>
            </button>
          </li>
        ))}
        {followLink && <li className="shrink-0">
          <a
            href="#/creators"
            className="flex w-20 flex-col items-center gap-1.5 text-center rounded-box focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="rounded-full bg-base-300 p-0.5">
              <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-base-100 bg-base-200 text-2xl text-base-content/60" aria-hidden="true">+</span>
            </span>
            <span className="w-full truncate text-xs text-base-content/60">Follow</span>
          </a>
        </li>}
      </ul>
    </section>
  )
}
