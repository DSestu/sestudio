import { useEffect, useState } from 'react'
import type { ChannelInfo, SeasonCard, VideoInfo } from '../api'
import { fetchChannel, videoSeasonCard } from '../api'
import EmptyState from '../components/EmptyState'
import { VideoThumb } from '../components/search/LinkCard'
import { sourceIcon } from '../sourceLook'
import { videoMeta } from '../videoLinks'
import { useWatchState, watchKey } from '../watchState'
import { addWatcher, removeWatcher, updateWatcher, useWatchers, watcherForChannel } from '../watchers'

interface Props {
  url: string
  onOpen: (card: SeasonCard) => void
}

interface Fetched {
  url: string
  channel?: ChannelInfo
  error?: string
}

/**
 * A YouTube or Twitch channel, read like a show: its live stream when it is on,
 * then its latest videos. A grid on desktop, rows with the thumbnail on the
 * left on phones.
 */
export default function ChannelView({ url, onOpen }: Props) {
  const [fetched, setFetched] = useState<Fetched | null>(null)
  const [attempt, setAttempt] = useState(0)
  const watch = useWatchState()

  useEffect(() => {
    let live = true
    fetchChannel(url).then(
      channel => { if (live) setFetched({ url, channel }) },
      (e: Error) => { if (live) setFetched({ url, error: e.message }) },
    )
    return () => { live = false }
  }, [url, attempt])

  const current = fetched?.url === url ? fetched : null
  if (!current) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading channel">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-full bg-base-300 animate-pulse" />
          <div className="h-6 w-48 rounded bg-base-300 animate-pulse" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="aspect-video rounded-box bg-base-300 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }
  const channel = current.channel
  if (!channel) {
    return (
      <EmptyState
        title="Channel unavailable"
        message={current.error ?? 'It could not be loaded.'}
        action={{ label: 'Try again', onClick: () => { setFetched(null); setAttempt(a => a + 1) } }}
      />
    )
  }

  const icon = sourceIcon(channel.source)
  const site = channel.source === 'twitch' ? 'Twitch' : 'YouTube'

  function tile(v: VideoInfo) {
    const entry = watch[watchKey(v.title, 0, 1)]
    const fraction = entry ? (entry.watched ? 1 : entry.duration ? entry.position / entry.duration : 0) : 0
    return (
      <li key={v.page_url}>
        <button
          type="button"
          onClick={() => onOpen(videoSeasonCard(v))}
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
              {[videoMeta({ ...v, channel: '' }), entry?.watched ? 'Watched' : null].filter(Boolean).join(' · ')}
            </p>
          </div>
        </button>
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-4">
        {channel.avatar ? (
          <img src={channel.avatar} alt="" className="h-12 w-12 sm:h-16 sm:w-16 rounded-full object-cover bg-base-300" />
        ) : (
          <div className="h-12 w-12 sm:h-16 sm:w-16 rounded-full bg-base-300" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight truncate">{channel.name}</h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-base-content/50">
            {icon && <img src={icon} alt="" className="h-3.5 w-3.5" />}
            {site} · {channel.videos.length} latest {channel.source === 'twitch' ? 'past broadcasts' : 'videos'}
          </p>
        </div>
        <FollowControls channel={channel} />
      </header>

      {channel.live && (
        <section aria-labelledby="channel-live">
          <h3 id="channel-live" className="sr-only">Live now</h3>
          <button
            type="button"
            onClick={() => onOpen(videoSeasonCard(channel.live!))}
            className="flex flex-col sm:flex-row gap-3 sm:gap-4 w-full text-left rounded-box border border-error/40 bg-base-200 p-3"
          >
            <VideoThumb info={channel.live} className="w-full sm:w-80" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-error">Live now</p>
              <p className="mt-1 font-semibold leading-snug line-clamp-2">{channel.live.title}</p>
              <p className="mt-1 text-xs text-base-content/50">{videoMeta({ ...channel.live, channel: '' })}</p>
            </div>
          </button>
        </section>
      )}

      {channel.videos.length ? (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-x-4 sm:gap-y-6">
          {channel.videos.map(tile)}
        </ul>
      ) : (
        <EmptyState title="No videos yet" message={`${channel.name} has nothing to watch here for now.`} />
      )}
    </div>
  )
}

/** Follow: new videos (and Twitch going live) land in Activity; with
 *  auto-download on, each new video is downloaded too. */
function FollowControls({ channel }: { channel: ChannelInfo }) {
  const watcher = watcherForChannel(useWatchers(), channel.url)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch {
      setError('That did not go through. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const follow = () => run(() => addWatcher({
    kind: 'channel',
    label: channel.name,
    config: { channel_url: channel.url, source: channel.source, name: channel.name, avatar: channel.avatar },
  }))

  return (
    <div className="flex flex-col items-end gap-1.5 shrink-0">
      <div className="flex items-center gap-3">
        {watcher && (
          <label className="flex items-center gap-2 text-xs text-base-content/60 cursor-pointer">
            <input
              type="checkbox"
              className="toggle toggle-primary toggle-sm"
              checked={watcher.auto_download}
              disabled={busy}
              onChange={e => run(() => updateWatcher(watcher.id, { auto_download: e.target.checked }))}
            />
            <span className="max-sm:hidden">Auto-download new</span>
            <span className="sm:hidden">Auto</span>
          </label>
        )}
        <button
          type="button"
          disabled={busy}
          aria-pressed={!!watcher}
          onClick={() => (watcher ? run(() => removeWatcher(watcher.id)) : follow())}
          className={`btn btn-sm ${watcher ? '' : 'btn-primary'}`}
        >
          {watcher ? 'Following' : 'Follow'}
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-error">{error}</p>}
    </div>
  )
}
