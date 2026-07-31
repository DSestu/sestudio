import { MediaPlayer, MediaProvider } from '@vidstack/react'
import { defaultLayoutIcons, DefaultVideoLayout } from '@vidstack/react/player/layouts/default'
import '@vidstack/react/player/styles/default/theme.css'
import '@vidstack/react/player/styles/default/layouts/video.css'
import ProviderChips from './ProviderChips'
import { useProviderSources } from '../useProviderSources'

interface Props {
  embedUrls: Record<string, string>
  title: string
  onClose: () => void
}

export default function PlayerModal({ embedUrls, title, onClose }: Props) {
  const { providers, status, sources, active, select, markFailed, probing } = useProviderSources(embedUrls)
  const activeSource = active ? sources[active] : null

  return (
    <div className="modal modal-open" onClick={onClose}>
      <div className="modal-box max-w-4xl p-0 overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-base-300">
          <h2 className="font-semibold text-base truncate">{title}</h2>
          <button onClick={onClose} className="btn btn-sm btn-circle btn-ghost">✕</button>
        </div>

        {/* Providers */}
        <div className="px-6 py-3 border-b border-base-300">
          <ProviderChips providers={providers} active={active} status={status} onSelect={select} />
        </div>

        {/* Video */}
        <div className="bg-black aspect-video flex items-center justify-center">
          {probing && !activeSource && (
            <div className="flex items-center gap-3 text-base-content/50">
              <span className="loading loading-spinner loading-lg" /> Testing sources…
            </div>
          )}
          {!probing && !activeSource && (
            <div className="text-center px-6">
              <p className="text-error text-sm mb-1">
                {active ? 'This provider is unavailable.' : 'No playable source for this episode.'}
              </p>
              {providers.some(p => sources[p]) && (
                <p className="text-base-content/40 text-xs mt-1">Pick a working source above.</p>
              )}
            </div>
          )}
          {activeSource && (
            <MediaPlayer
              key={activeSource.proxy_url}
              className="w-full h-full"
              title={title}
              src={{
                src: activeSource.proxy_url,
                type: activeSource.kind === 'hls' ? 'application/x-mpegurl' : 'video/mp4',
              }}
              autoPlay
              playsInline
              onError={() => { if (active) markFailed(active) }}
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
