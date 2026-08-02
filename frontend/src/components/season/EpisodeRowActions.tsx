// Big, clearly-tappable icon actions for an episode row (play / cast / open).
const iconBtn = 'btn btn-ghost btn-md btn-square text-base-content/50 hover:text-primary'

interface Props {
  hasProviders: boolean
  pageUrl: string
  onPlay: () => void
  onCast: () => void
}

export default function EpisodeRowActions({ hasProviders, pageUrl, onPlay, onCast }: Props) {
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {hasProviders && (
        <>
          <button
            onClick={e => { e.stopPropagation(); onPlay() }}
            title="Play in browser"
            aria-label="Play in browser"
            className={iconBtn}
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
          <button
            onClick={e => { e.stopPropagation(); onCast() }}
            title="Cast to a device"
            aria-label="Cast to a device"
            className={iconBtn}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2h-5M3 11a6 6 0 016 6M3 15a2 2 0 012 2M3 19h.01" />
            </svg>
          </button>
        </>
      )}
      <a
        href={pageUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Open on fstream"
        aria-label="Open on fstream"
        className={iconBtn}
        onClick={e => e.stopPropagation()}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </a>
    </div>
  )
}
