import { useState } from 'react'
import {
  castPlayPause, castSeek, castSeekBy, castSetVolume, castStop, castToggleMute, castVolumeBy,
  useCastState,
} from '../cast'
import { useModalBack } from '../useModalBack'
import { getCastQueue } from '../castQueue'
import { getPlaybackSession } from '../playbackSession'
import { requestPullback } from '../pullback'
import { saveProgress } from '../watchState'
import ResponsiveModal from './ResponsiveModal'
import Transport from './cast/Transport'

/**
 * Persistent Chromecast controller for a session started elsewhere. Renders
 * nothing unless a session is active; shows a floating "Casting" pill that
 * opens a control modal. The watch view has its own inline transport, so this
 * only appears once the user navigates away. The session — and thus this UI —
 * survives a page reload because the Cast SDK auto-rejoins the origin-scoped
 * session.
 */
export default function CastControls() {
  const cast = useCastState()
  const [open, setOpen] = useState(false)
  useModalBack(open, () => setOpen(false))

  if (!cast.connected) return null

  return (
    <>
      {/* Floating pill — above all other overlays; hidden while its own modal is open */}
      {!open && <button
        onClick={() => setOpen(true)}
        className="fixed left-4 md:left-6 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-6 z-[9999] btn btn-primary gap-2 shadow-xl"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2h-5M3 11a6 6 0 016 6M3 15a2 2 0 012 2M3 19h.01" />
        </svg>
        <span className="max-w-[40vw] truncate">{cast.title || 'Casting'}</span>
        <span className={`badge badge-sm ${cast.isPaused ? 'badge-ghost' : 'badge-success'}`}>
          {cast.isPaused ? 'Paused' : 'Playing'}
        </span>
      </button>}

      {open && (
        <ResponsiveModal onClose={() => setOpen(false)} boxClassName="max-w-md">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-semibold text-base">Casting</h2>
            <button onClick={() => setOpen(false)} aria-label="Close" className="btn btn-circle btn-ghost sm:btn-sm">✕</button>
          </div>
          <p className="text-base-content/60 text-sm mb-4 truncate">{cast.title || 'Unknown title'}</p>

          <Transport
            position={cast.currentTime}
            duration={cast.duration}
            isPaused={cast.isPaused}
            muted={cast.muted}
            volume={cast.volume}
            canSeek={cast.canSeek}
            canControlVolume={cast.canControlVolume}
            onSeek={castSeek}
            onSeekBy={castSeekBy}
            onPlayPause={castPlayPause}
            onToggleMute={castToggleMute}
            onSetVolume={castSetVolume}
            onVolumeBy={castVolumeBy}
          />

          <div className="modal-action justify-between">
            {/* Pull-back needs the in-memory session (lost on page reload). */}
            {getPlaybackSession()?.target === 'chromecast' && (
              <button
                onClick={() => {
                  const session = getPlaybackSession()
                  if (!session) return
                  saveProgress(session.episode, cast.currentTime, cast.duration)
                  const q = getCastQueue()
                  requestPullback(q ?? { episodes: [session.episode], index: 0 })
                  castStop()
                  setOpen(false)
                }}
                className="btn btn-sm btn-primary btn-outline"
              >
                Watch here
              </button>
            )}
            <button onClick={castStop} className="btn btn-error btn-sm">Stop casting</button>
          </div>
        </ResponsiveModal>
      )}
    </>
  )
}
