import { useState } from 'react'
import {
  dlnaPause, dlnaResume, dlnaSeek, dlnaSeekBy, dlnaSetVolume, dlnaStop, dlnaToggleMute,
  dlnaVolumeBy, useDlnaState,
} from '../dlnaControl'
import { getCastQueue } from '../castQueue'
import { getPlaybackSession } from '../playbackSession'
import { requestPullback } from '../pullback'
import { saveProgress } from '../watchState'
import { useModalBack } from '../useModalBack'
import ResponsiveModal from './ResponsiveModal'
import Transport from './cast/Transport'

/**
 * Persistent controller for an active DLNA (TV) session started elsewhere.
 * Renders nothing unless a session is active; a floating pill (bottom-right,
 * clear of the Chromecast pill) opens a control modal. The watch view has its
 * own inline transport, so this only appears once the user navigates away.
 * Survives reload via server-side state.
 */
export default function DlnaControls() {
  const dlna = useDlnaState()
  const [open, setOpen] = useState(false)
  useModalBack(open, () => setOpen(false))

  if (!dlna.connected) return null

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed right-4 md:right-6 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-6 z-[9999] btn btn-primary gap-2 shadow-xl"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 6a2 2 0 012-2h16a2 2 0 012 2v9a2 2 0 01-2 2h-7M8 21h4m-6-4l3 4" />
          </svg>
          <span className="max-w-[40vw] truncate">{dlna.title || 'Casting to TV'}</span>
          <span className={`badge badge-sm ${dlna.isPaused ? 'badge-ghost' : 'badge-success'}`}>
            {dlna.isPaused ? 'Paused' : 'Playing'}
          </span>
        </button>
      )}

      {open && (
        <ResponsiveModal onClose={() => setOpen(false)} boxClassName="max-w-md">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-semibold text-base">Casting to TV</h2>
            <button onClick={() => setOpen(false)} aria-label="Close" className="btn btn-circle btn-ghost sm:btn-sm">✕</button>
          </div>
          <p className="text-base-content/60 text-sm mb-4 truncate">{dlna.title || 'Unknown title'}</p>

          <Transport
            position={dlna.position}
            duration={dlna.duration}
            isPaused={dlna.isPaused}
            muted={dlna.muted}
            volume={dlna.volume}
            onSeek={dlnaSeek}
            onSeekBy={dlnaSeekBy}
            onPlayPause={() => (dlna.isPaused ? dlnaResume() : dlnaPause())}
            onToggleMute={dlnaToggleMute}
            onSetVolume={dlnaSetVolume}
            onVolumeBy={dlnaVolumeBy}
          />

          <div className="modal-action justify-between">
            {/* Pull-back needs the in-memory session (lost on page reload). */}
            {getPlaybackSession()?.target === 'dlna' && (
              <button
                onClick={() => {
                  const session = getPlaybackSession()
                  if (!session) return
                  saveProgress(session.episode, dlna.position, dlna.duration)
                  const q = getCastQueue()
                  requestPullback(q ?? { episodes: [session.episode], index: 0 })
                  dlnaStop()
                  setOpen(false)
                }}
                className="btn btn-sm btn-primary btn-outline"
              >
                Watch here
              </button>
            )}
            <button onClick={() => { dlnaStop(); setOpen(false) }} className="btn btn-error btn-sm">Stop casting</button>
          </div>
        </ResponsiveModal>
      )}
    </>
  )
}
