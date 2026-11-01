import { useEffect, useState } from 'react'
import type { LiveStream, SeasonCard } from '../api'
import { fetchLive, videoSeasonCard } from '../api'
import { useWatchers } from '../watchers'

/** How often the strip checks again while Home is open. */
const REFRESH_MS = 120_000

/**
 * Followed channels live now, as a row of avatars ringed in red. Hidden when
 * nobody is on, so it costs Home nothing the rest of the time.
 */
export default function LiveNow({ onOpen }: { onOpen: (card: SeasonCard) => void }) {
  const [live, setLive] = useState<LiveStream[]>([])
  // Re-checked when a channel is followed or dropped, not only on a timer.
  const follows = useWatchers().filter(w => w.kind === 'channel').length

  useEffect(() => {
    if (!follows) return
    let alive = true
    const check = () => fetchLive().then(next => { if (alive) setLive(next) })
    check()
    const timer = setInterval(check, REFRESH_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [follows])

  if (!follows || !live.length) return null
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
      </ul>
    </section>
  )
}
