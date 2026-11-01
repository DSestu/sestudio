import { useEffect, useState } from 'react'
import type { ChannelHit } from '../../api'
import { searchChannels } from '../../api'
import { channelHref } from '../../videoLinks'

function followers(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)
}

/** Twitch channels named like the query, as a row of avatars (ringed in red
 *  when live), each opening its channel page. Hidden when none match. */
export default function ChannelHits({ query }: { query: string }) {
  const [found, setFound] = useState<{ query: string; hits: ChannelHit[] } | null>(null)
  useEffect(() => {
    let alive = true
    // A failed search only hides the strip: the videos below still stand.
    searchChannels(query).catch(() => []).then(hits => { if (alive) setFound({ query, hits }) })
    return () => { alive = false }
  }, [query])

  const hits = found?.query === query ? found.hits : null
  if (hits && !hits.length) return null
  return (
    <section aria-labelledby="channel-hits" className="flex flex-col gap-3">
      <h2 id="channel-hits" className="text-lg font-semibold tracking-tight">Twitch channels</h2>
      <ul className="flex gap-4 overflow-x-auto pb-1 -mx-1 px-1" aria-busy={!hits}>
        {(hits ?? Array.from({ length: 6 }, () => null)).map((c, i) => (
          <li key={c?.url ?? i} className="shrink-0">
            {c ? (
              <a
                href={channelHref(c.url, c.source)}
                title={c.game ? `Live: ${c.game}` : c.name}
                className="flex w-24 flex-col items-center gap-1.5 text-center rounded-box focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className={`rounded-full p-0.5 ${c.live ? 'bg-error' : 'bg-transparent'}`}>
                  {c.avatar
                    ? <img src={c.avatar} alt="" loading="lazy" className="h-16 w-16 rounded-full border-2 border-base-100 object-cover" />
                    : <span className="block h-16 w-16 rounded-full border-2 border-base-100 bg-base-300" />}
                </span>
                <span className="w-full truncate text-xs font-medium">{c.name}</span>
                <span className="w-full truncate text-[11px] text-base-content/50">
                  {c.live ? <span className="text-error font-semibold">Live</span> : `${followers(c.followers)} followers`}
                </span>
              </a>
            ) : (
              <span className="flex w-24 flex-col items-center gap-1.5">
                <span className="h-[4.25rem] w-[4.25rem] rounded-full bg-base-300 animate-pulse" />
                <span className="h-3 w-16 rounded bg-base-300 animate-pulse" />
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
