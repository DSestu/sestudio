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

const SEEK_STEPS = [
  { label: '-5m', delta: -300 },
  { label: '-1m', delta: -60 },
  { label: '-30s', delta: -30 },
  { label: '-10s', delta: -10 },
  { label: '+10s', delta: 10 },
  { label: '+30s', delta: 30 },
  { label: '+1m', delta: 60 },
  { label: '+5m', delta: 300 },
]

function fmt(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds % 60)
  const m = Math.floor(seconds / 60) % 60
  const h = Math.floor(seconds / 3600)
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return (h > 0 ? `${h}:` : '') + `${mm}:${String(s).padStart(2, '0')}`
}

/**
 * Persistent controller for an active DLNA (TV) cast session. Renders nothing
 * unless a session is active; a floating pill (bottom-right, clear of the
 * Chromecast pill) opens a control modal. Survives reload via server-side state.
 */
export default function DlnaControls() {
  const dlna = useDlnaState()
  const [open, setOpen] = useState(false)
  const [seeking, setSeeking] = useState<number | null>(null)
  useModalBack(open, () => setOpen(false))

  if (!dlna.connected) return null

  const time = seeking ?? dlna.position

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

            {/* Timeline */}
            <input
              type="range"
              min={0}
              max={dlna.duration || 0}
              value={time}
              disabled={!dlna.duration}
              onChange={e => setSeeking(Number(e.target.value))}
              onMouseUp={() => { if (seeking !== null) { dlnaSeek(seeking); setSeeking(null) } }}
              onTouchEnd={() => { if (seeking !== null) { dlnaSeek(seeking); setSeeking(null) } }}
              className="range range-primary range-sm w-full"
            />
            <div className="flex justify-between text-xs text-base-content/50 mt-1 mb-4 font-mono">
              <span>{fmt(time)}</span>
              <span>{fmt(dlna.duration)}</span>
            </div>

            {/* Transport */}
            <div className="flex items-center justify-center flex-wrap gap-2 mb-4">
              {SEEK_STEPS.slice(0, 4).map(s => (
                <button key={s.label} onClick={() => dlnaSeekBy(s.delta)} className="btn btn-ghost font-mono sm:btn-sm">{s.label}</button>
              ))}
              <button
                onClick={() => (dlna.isPaused ? dlnaResume() : dlnaPause())}
                className="btn btn-circle btn-primary btn-lg"
                aria-label={dlna.isPaused ? 'Play' : 'Pause'}
              >
                {dlna.isPaused ? (
                  <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                ) : (
                  <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
                )}
              </button>
              {SEEK_STEPS.slice(4).map(s => (
                <button key={s.label} onClick={() => dlnaSeekBy(s.delta)} className="btn btn-ghost font-mono sm:btn-sm">{s.label}</button>
              ))}
            </div>

            {/* Volume */}
            <div className="flex items-center gap-2">
              <button onClick={dlnaToggleMute} aria-label={dlna.muted ? 'Unmute' : 'Mute'} className="btn btn-ghost btn-square sm:btn-sm">
                {dlna.muted ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15zM17 9l4 4m0-4l-4 4" /></svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15z M15 9a3 3 0 010 6 M18 6a7 7 0 010 12" /></svg>
                )}
              </button>
              <button onClick={() => dlnaVolumeBy(-0.05)} aria-label="Volume down" className="btn btn-ghost btn-square font-mono sm:btn-sm">−</button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={dlna.muted ? 0 : dlna.volume}
                onChange={e => dlnaSetVolume(Number(e.target.value))}
                className="range range-sm flex-1"
              />
              <button onClick={() => dlnaVolumeBy(0.05)} aria-label="Volume up" className="btn btn-ghost btn-square font-mono sm:btn-sm">＋</button>
            </div>

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
