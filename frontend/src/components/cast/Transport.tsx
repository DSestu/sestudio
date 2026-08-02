import { useState } from 'react'

// Relative-seek buttons shown around play/pause, in display order.
const SEEK_STEPS: { label: string; delta: number }[] = [
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

export interface TransportProps {
  position: number
  duration: number
  isPaused: boolean
  muted: boolean
  volume: number
  canSeek?: boolean
  canControlVolume?: boolean
  onSeek: (seconds: number) => void
  onSeekBy: (delta: number) => void
  onPlayPause: () => void
  onToggleMute: () => void
  onSetVolume: (v: number) => void
  onVolumeBy: (delta: number) => void
}

/**
 * Timeline + transport + volume for an active cast session. Shared by the
 * floating pill controllers and the watch view's inline output panel, so all
 * three surfaces stay in step.
 */
export default function Transport({
  position, duration, isPaused, muted, volume,
  canSeek = true, canControlVolume = true,
  onSeek, onSeekBy, onPlayPause, onToggleMute, onSetVolume, onVolumeBy,
}: TransportProps) {
  // While dragging the timeline, show the local value instead of live updates.
  const [seeking, setSeeking] = useState<number | null>(null)
  const time = seeking ?? position

  function commitSeek() {
    if (seeking === null) return
    onSeek(seeking)
    setSeeking(null)
  }

  return (
    <div>
      <input
        type="range"
        min={0}
        max={duration || 0}
        value={time}
        disabled={!canSeek || !duration}
        aria-label="Seek"
        onChange={e => setSeeking(Number(e.target.value))}
        onMouseUp={commitSeek}
        onTouchEnd={commitSeek}
        className="range range-primary range-sm w-full"
      />
      <div className="flex justify-between text-xs text-base-content/50 mt-1 mb-4 font-mono">
        <span>{fmt(time)}</span>
        <span>{fmt(duration)}</span>
      </div>

      <div className="flex items-center justify-center flex-wrap gap-2 mb-4">
        {SEEK_STEPS.slice(0, 4).map(s => (
          <button key={s.label} onClick={() => onSeekBy(s.delta)} disabled={!canSeek} className="btn btn-ghost font-mono sm:btn-sm">
            {s.label}
          </button>
        ))}
        <button onClick={onPlayPause} className="btn btn-circle btn-primary btn-lg" aria-label={isPaused ? 'Play' : 'Pause'}>
          {isPaused ? (
            <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          ) : (
            <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
          )}
        </button>
        {SEEK_STEPS.slice(4).map(s => (
          <button key={s.label} onClick={() => onSeekBy(s.delta)} disabled={!canSeek} className="btn btn-ghost font-mono sm:btn-sm">
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={onToggleMute} aria-label={muted ? 'Unmute' : 'Mute'} className="btn btn-ghost btn-square sm:btn-sm">
          {muted ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15zM17 9l4 4m0-4l-4 4" /></svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15z M15 9a3 3 0 010 6 M18 6a7 7 0 010 12" /></svg>
          )}
        </button>
        <button onClick={() => onVolumeBy(-0.05)} disabled={!canControlVolume} aria-label="Volume down" className="btn btn-ghost btn-square font-mono sm:btn-sm">−</button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          disabled={!canControlVolume}
          aria-label="Volume"
          onChange={e => onSetVolume(Number(e.target.value))}
          className="range range-sm flex-1"
        />
        <button onClick={() => onVolumeBy(0.05)} disabled={!canControlVolume} aria-label="Volume up" className="btn btn-ghost btn-square font-mono sm:btn-sm">＋</button>
      </div>
    </div>
  )
}
