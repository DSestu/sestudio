import { useState } from 'react'
import { useLive } from '../liveNow'
import { channelHref } from '../videoLinks'
import { removeWatcher, updateWatcher, useWatchers } from '../watchers'
import SourceIcon from './SourceIcon'

/**
 * The YouTube and Twitch channels you follow, managed in place: each opens its
 * page, and carries its auto-download switch and a way to stop following.
 * *source* narrows the list to one site, as the page's filter does.
 */
export default function FollowedChannels({ source }: { source?: string }) {
  const all = useWatchers().filter(w => w.kind === 'channel')
  const live = useLive(all.length)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')
  const channels = all
    .filter(w => !source || w.config.source === source)
    .map(w => ({
      watcher: w,
      url: String(w.config.channel_url ?? ''),
      source: String(w.config.source ?? ''),
      name: String(w.config.name || w.label),
      avatar: String(w.config.avatar ?? ''),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  if (!channels.length) return null

  async function run(id: number, action: () => Promise<unknown>) {
    setBusy(id)
    setError('')
    try {
      await action()
    } catch {
      setError('That did not go through. Try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="following" className="flex flex-col gap-2">
      <h3 id="following" className="flex items-baseline gap-2 text-lg font-semibold tracking-tight">
        Following
        <span className="text-sm font-normal text-base-content/50 tabular-nums">{channels.length}</span>
      </h3>
      <ul className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 rounded-box">
        {channels.map(c => {
          const onAir = live.find(s => s.page_url === c.url)
          const site = c.source === 'twitch' ? 'Twitch' : 'YouTube'
          return (
            <li key={c.watcher.id} className="flex items-center gap-3 py-2 border-b border-base-300">
              <a href={channelHref(c.url, c.source)} className="flex min-w-0 flex-1 items-center gap-3 group">
                <span className={`shrink-0 rounded-full p-0.5 ${onAir ? 'bg-error' : ''}`}>
                  {c.avatar
                    ? <img src={c.avatar} alt="" loading="lazy" className="h-9 w-9 rounded-full object-cover border-2 border-base-100" />
                    : <span className="block h-9 w-9 rounded-full bg-base-300 border-2 border-base-100" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium group-hover:underline">{c.name}</span>
                  <span className="flex items-center gap-1.5 text-xs text-base-content/50">
                    <SourceIcon id={c.source} label={site} className="w-3.5 h-3.5" />
                    {onAir ? <span className="text-error font-semibold">Live{onAir.game ? ` · ${onAir.game}` : ''}</span> : site}
                  </span>
                </span>
              </a>
              <label className="flex shrink-0 items-center gap-2 text-xs text-base-content/60 cursor-pointer">
                <input
                  type="checkbox"
                  className="toggle toggle-primary toggle-sm"
                  checked={c.watcher.auto_download}
                  disabled={busy === c.watcher.id}
                  aria-label={`Download ${c.name}'s new videos automatically`}
                  onChange={e => run(c.watcher.id, () => updateWatcher(c.watcher.id, { auto_download: e.target.checked }))}
                />
                <span className="max-sm:hidden">Auto-download</span>
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-square shrink-0 text-base-content/50 hover:text-error"
                disabled={busy === c.watcher.id}
                aria-label={`Stop following ${c.name}`}
                title="Stop following"
                onClick={() => run(c.watcher.id, () => removeWatcher(c.watcher.id))}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </li>
          )
        })}
      </ul>
      {error && <p role="alert" className="text-xs text-error">{error}</p>}
    </section>
  )
}
