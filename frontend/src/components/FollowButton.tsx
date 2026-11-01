import { useState } from 'react'
import { addWatcher, removeWatcher, updateWatcher, useWatchers, watcherForChannel } from '../watchers'

interface Channel {
  /** Its canonical address, which identifies the follow. */
  url: string
  source: string
  name: string
  avatar: string
}

interface Props {
  channel: Channel
  /** Also offer the auto-download toggle once followed (the channel page). */
  autoDownload?: boolean
  /** Fill its grid cell, beside the link card's other buttons. */
  block?: boolean
}

/** Follow: new videos (and Twitch going live) land in Activity; with
 *  auto-download on, each new video is downloaded too. */
export default function FollowButton({ channel, autoDownload = false, block = false }: Props) {
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
    <div className={`flex flex-col gap-1.5 shrink-0 ${block ? '' : 'items-end'}`}>
      <div className={`flex items-center gap-3 ${block ? 'w-full' : ''}`}>
        {autoDownload && watcher && (
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
          className={`btn btn-sm ${block ? 'w-full' : ''} ${watcher ? '' : block ? 'btn-outline btn-primary' : 'btn-primary'}`}
        >
          {watcher ? 'Following' : 'Follow'}
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-error">{error}</p>}
    </div>
  )
}
