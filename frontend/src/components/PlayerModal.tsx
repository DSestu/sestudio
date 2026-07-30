import { useEffect, useState } from 'react'
import { MediaPlayer, MediaProvider } from '@vidstack/react'
import { defaultLayoutIcons, DefaultVideoLayout } from '@vidstack/react/player/layouts/default'
import '@vidstack/react/player/styles/default/theme.css'
import '@vidstack/react/player/styles/default/layouts/video.css'
import type { StreamSource } from '../api'
import { resolveStream } from '../api'

interface Props {
  embedUrls: Record<string, string>
  title: string
  onClose: () => void
}

export default function PlayerModal({ embedUrls, title, onClose }: Props) {
  const [source, setSource] = useState<StreamSource | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The modal is keyed per episode (see SeasonTree), so it remounts on change —
  // state starts fresh and this effect only needs to resolve. The backend tries
  // each provider in turn, so a dead uqload embed falls back to vidzy/netu.
  useEffect(() => {
    const controller = new AbortController()
    resolveStream(embedUrls, controller.signal)
      .then(s => setSource(s))
      .catch((e: unknown) => {
        if (controller.signal.aborted) return
        setError(e instanceof Error ? e.message : String(e))
      })
    return () => controller.abort()
  }, [embedUrls])

  return (
    <div className="modal modal-open" onClick={onClose}>
      <div
        className="modal-box max-w-4xl p-0 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-base-300">
          <h2 className="font-semibold text-base truncate">{title}</h2>
          <button onClick={onClose} className="btn btn-sm btn-circle btn-ghost">✕</button>
        </div>

        {/* Body */}
        <div className="bg-black aspect-video flex items-center justify-center">
          {error && (
            <p className="text-error text-sm px-6 text-center">
              Could not load stream: {error}
            </p>
          )}
          {!error && !source && (
            <span className="loading loading-spinner loading-lg text-base-content/40" />
          )}
          {source && (
            <MediaPlayer
              className="w-full h-full"
              title={title}
              src={{
                src: source.proxy_url,
                type: source.kind === 'hls' ? 'application/x-mpegurl' : 'video/mp4',
              }}
              autoPlay
              playsInline
            >
              <MediaProvider />
              <DefaultVideoLayout icons={defaultLayoutIcons} />
            </MediaPlayer>
          )}
        </div>
      </div>
    </div>
  )
}
