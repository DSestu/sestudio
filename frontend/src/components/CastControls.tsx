import { useState } from 'react'
import {
  castPlayPause, castSeek, castSeekBy, castSetVolume, castStop, castToggleMute, useCastState,
} from '../cast'

// Relative-seek buttons shown around play/pause, in display order.
const SEEK_STEPS: { label: string; delta: number }[] = [
  { label: '-5m', delta: -300 },
  { label: '-10s', delta: -10 },
  { label: '-30s', delta: -30 },
  { label: '+30s', delta: 30 },
  { label: '+10s', delta: 10 },
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
 * Persistent Chromecast controller. Renders nothing unless a session is active;
 * shows a floating "Casting" pill that opens a control modal (timeline, volume,
 * play/pause, stop). The session — and thus this UI — survives a page reload
 * because the Cast SDK auto-rejoins the origin-scoped session.
 */
export default function CastControls() {
  const cast = useCastState()
  const [open, setOpen] = useState(false)
  // While dragging the timeline, show the local value instead of live updates.
  const [seeking, setSeeking] = useState<number | null>(null)

  if (!cast.connected) return null

  const time = seeking ?? cast.currentTime

  return (
    <>
      {/* Floating pill — above all other overlays; hidden while its own modal is open */}
      {!open && <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 left-6 z-[9999] btn btn-primary gap-2 shadow-xl"
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
        <div className="modal modal-open" onClick={() => setOpen(false)}>
          <div className="modal-box max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-base">Casting</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" className="btn btn-sm btn-circle btn-ghost">✕</button>
            </div>
            <p className="text-base-content/60 text-sm mb-4 truncate">{cast.title || 'Unknown title'}</p>

            {/* Timeline */}
            <input
              type="range"
              min={0}
              max={cast.duration || 0}
              value={time}
              disabled={!cast.canSeek || !cast.duration}
              onChange={e => setSeeking(Number(e.target.value))}
              onMouseUp={() => { if (seeking !== null) { castSeek(seeking); setSeeking(null) } }}
              onTouchEnd={() => { if (seeking !== null) { castSeek(seeking); setSeeking(null) } }}
              className="range range-primary range-sm w-full"
            />
            <div className="flex justify-between text-xs text-base-content/50 mt-1 mb-4 font-mono">
              <span>{fmt(time)}</span>
              <span>{fmt(cast.duration)}</span>
            </div>

            {/* Transport */}
            <div className="flex items-center justify-center flex-wrap gap-2 mb-4">
              {SEEK_STEPS.slice(0, 3).map(s => (
                <button key={s.label} onClick={() => castSeekBy(s.delta)} disabled={!cast.canSeek} className="btn btn-sm btn-ghost font-mono">
                  {s.label}
                </button>
              ))}
              <button onClick={castPlayPause} className="btn btn-circle btn-primary btn-lg" aria-label={cast.isPaused ? 'Play' : 'Pause'}>
                {cast.isPaused ? (
                  <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                ) : (
                  <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
                )}
              </button>
              {SEEK_STEPS.slice(3).map(s => (
                <button key={s.label} onClick={() => castSeekBy(s.delta)} disabled={!cast.canSeek} className="btn btn-sm btn-ghost font-mono">
                  {s.label}
                </button>
              ))}
            </div>

            {/* Volume */}
            <div className="flex items-center gap-3">
              <button onClick={castToggleMute} aria-label={cast.muted ? 'Unmute' : 'Mute'} className="btn btn-ghost btn-sm btn-square">
                {cast.muted ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15zM17 9l4 4m0-4l-4 4" /></svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15z M15 9a3 3 0 010 6 M18 6a7 7 0 010 12" /></svg>
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={cast.muted ? 0 : cast.volume}
                disabled={!cast.canControlVolume}
                onChange={e => castSetVolume(Number(e.target.value))}
                className="range range-sm flex-1"
              />
            </div>

            <div className="modal-action">
              <button onClick={castStop} className="btn btn-error btn-sm">Stop casting</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
