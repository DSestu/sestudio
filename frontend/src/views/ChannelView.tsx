import { useEffect, useState } from 'react'
import type { ChannelInfo, SeasonCard, VideoInfo } from '../api'
import { downloadVideo, fetchChannel, videoSeasonCard } from '../api'
import EmptyState from '../components/EmptyState'
import VideoGrid from '../components/VideoGrid'
import { VideoThumb } from '../components/search/LinkCard'
import { sourceIcon } from '../sourceLook'
import { videoMeta } from '../videoLinks'
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
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 rounded-box border border-error/40 bg-base-200 p-3">
            <button type="button" onClick={() => onOpen(videoSeasonCard(channel.live!))} className="w-full sm:w-80 shrink-0" aria-label={`Watch ${channel.live.title}`}>
              <VideoThumb info={channel.live} className="w-full" />
            </button>
            <div className="min-w-0 flex flex-col gap-1">
              <p className="text-xs font-semibold text-error">Live now</p>
              <p className="font-semibold leading-snug line-clamp-2">{channel.live.title}</p>
              <p className="text-xs text-base-content/50">{videoMeta({ ...channel.live, channel: '' })}</p>
              <div className="mt-2 flex gap-2">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => onOpen(videoSeasonCard(channel.live!))}>Watch</button>
                <RecordButton live={channel.live} />
              </div>
            </div>
          </div>
        </section>
      )}

      {channel.videos.length ? (
        <VideoGrid videos={channel.videos} onOpen={onOpen} />
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

/** Record a live stream from now until it ends, into the downloads folder. */
function RecordButton({ live }: { live: VideoInfo }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle')
  return (
    <button
      type="button"
      className="btn btn-sm"
      disabled={state === 'busy' || state === 'done'}
      onClick={() => {
        setState('busy')
        downloadVideo(live).then(() => setState('done'), () => setState('failed'))
      }}
    >
      {state === 'done' ? 'Recording' : state === 'failed' ? 'Retry recording' : 'Record'}
    </button>
  )
}
