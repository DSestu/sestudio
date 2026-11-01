import { useEffect, useRef, useState } from 'react'
import type { ChannelHit } from '../api'
import { searchChannels } from '../api'
import { SEARCH_FIELD } from '../titleSearch'
import { channelHref } from '../videoLinks'
import FollowButton from './FollowButton'
import { SearchIcon } from './search/SearchParts'
import SourceIcon from './SourceIcon'

type Site = 'twitch' | 'youtube'
const SITES: { id: Site; label: string; unit: string }[] = [
  // Twitch first: it answers in about a second, YouTube in two.
  { id: 'twitch', label: 'Twitch', unit: 'followers' },
  { id: 'youtube', label: 'YouTube', unit: 'subscribers' },
]
/** Results per site, fewer when both sites share the list: enough to tell
 *  namesakes apart, not a directory. */
const SHOWN_ONE = 8
const SHOWN_BOTH = 4

function count(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)
}

interface Found {
  query: string
  hits?: ChannelHit[]
  error?: string
}

/**
 * Find a YouTube or Twitch channel by name and follow it in place. Searches as
 * you pause typing; each site answers on its own, so Twitch is not held back
 * by YouTube. *source* narrows it to one site, as the page's filter does.
 */
export default function FollowSearch({ source, autoFocus = false }: { source: string; autoFocus?: boolean }) {
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Partial<Record<Site, Found>>>({})
  const input = useRef<HTMLInputElement>(null)
  const sites = SITES.filter(s => !source || s.id === source)

  // A pause, not every keystroke: each YouTube search counts toward the rate
  // limit YouTube puts on the server's IP.
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 500)
    return () => clearTimeout(t)
  }, [text])

  useEffect(() => {
    if (query.length < 2) return
    let alive = true
    for (const site of SITES) {
      if (source && site.id !== source) continue
      searchChannels(query, site.id).then(
        hits => { if (alive) setFound(f => ({ ...f, [site.id]: { query, hits } })) },
        (e: Error) => { if (alive) setFound(f => ({ ...f, [site.id]: { query, error: e.message } })) },
      )
    }
    return () => { alive = false }
  }, [query, source])

  const active = query.length >= 2

  return (
    <section aria-labelledby="follow-search" className="flex flex-col gap-2">
      <h3 id="follow-search" className="text-sm font-medium text-base-content/70">Follow a channel</h3>
      <label className={`${SEARCH_FIELD} max-w-xl`}>
        <SearchIcon />
        <input
          ref={input}
          type="search"
          value={text}
          autoFocus={autoFocus}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') setText('') }}
          placeholder={source === 'youtube' ? 'A YouTube channel’s name' : source === 'twitch' ? 'A Twitch channel’s name' : 'A YouTube or Twitch channel’s name'}
          aria-label="Search channels to follow"
          className="grow bg-transparent outline-none text-sm min-w-0"
        />
      </label>

      {active && (
        <ul className="max-w-xl flex flex-col rounded-box border border-base-300 divide-y divide-base-300 overflow-hidden">
          {sites.map(site => {
            const result = found[site.id]?.query === query ? found[site.id] : undefined
            if (!result) {
              return (
                <li key={site.id} className="flex items-center gap-3 px-3 py-2.5 text-sm text-base-content/50" aria-busy="true">
                  <span className="loading loading-spinner loading-xs" />
                  Searching {site.label}…
                </li>
              )
            }
            if (result.error) {
              return <li key={site.id} role="alert" className="px-3 py-2.5 text-sm text-error">{site.label}: {result.error}</li>
            }
            if (!result.hits?.length) {
              return <li key={site.id} className="px-3 py-2.5 text-sm text-base-content/50">No {site.label} channel by that name.</li>
            }
            return result.hits.slice(0, sites.length > 1 ? SHOWN_BOTH : SHOWN_ONE).map(c => (
              <li key={c.url} className="flex items-center gap-3 px-3 py-2">
                <span className={`shrink-0 rounded-full p-0.5 ${c.live ? 'bg-error' : ''}`}>
                  {c.avatar
                    ? <img
                      src={c.avatar}
                      alt=""
                      loading="lazy"
                      // A dead avatar URL falls back to the plain circle behind it.
                      onError={e => { e.currentTarget.style.visibility = 'hidden' }}
                      className="h-9 w-9 rounded-full object-cover border-2 border-base-100 bg-base-300"
                    />
                    : <span className="block h-9 w-9 rounded-full bg-base-300 border-2 border-base-100" />}
                </span>
                <span className="min-w-0 flex-1">
                  {/* The page first, to tell namesakes apart before following. */}
                  <a href={channelHref(c.url, c.source)} className="block truncate text-sm font-medium hover:underline">{c.name}</a>
                  <span className="flex items-center gap-1.5 text-xs text-base-content/50">
                    <SourceIcon id={c.source} label={site.label} className="w-3.5 h-3.5" />
                    {c.live
                      ? <span className="text-error font-semibold">Live{c.game ? ` · ${c.game}` : ''}</span>
                      : <span className="tabular-nums">{count(c.followers)} {site.unit}</span>}
                  </span>
                </span>
                <FollowButton channel={{ url: c.url, source: c.source, name: c.name, avatar: c.avatar }} />
              </li>
            ))
          })}
        </ul>
      )}
    </section>
  )
}
