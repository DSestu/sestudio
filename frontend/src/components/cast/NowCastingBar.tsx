import { useRef, useState } from 'react'
import {
  castSeek, castSeekBy, castSetVolume, castStop, castToggleMute, castPlayPause, useCastState,
} from '../../cast'
import {
  dlnaPause, dlnaResume, dlnaSeek, dlnaSeekBy, dlnaSetVolume, dlnaStop, dlnaToggleMute, useDlnaState,
} from '../../dlnaControl'
import { getCastQueue } from '../../castQueue'
import type { Navigate } from '../../nav'
import { useCastSession } from '../../playbackSession'
import { requestPullback } from '../../pullback'
import { saveProgress } from '../../watchState'

// Whether the device has a real hover pointer — drives hover-to-open on desktop
// vs tap-to-open on touch. Evaluated once; the bar isn't rendered server-side.
const CAN_HOVER = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover)').matches

// Relative-seek magnitudes — one per column, applied backward (top row) and
// forward (bottom row) in the accordion's seek grid.
const SEEK_MAGS: { label: string; seconds: number }[] = [
  { label: '10s', seconds: 10 },
  { label: '30s', seconds: 30 },
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
]

const pad = (n: number) => String(n).padStart(2, '0')

function fmt(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds % 60)
  const m = Math.floor(seconds / 60) % 60
  const h = Math.floor(seconds / 3600)
  return (h > 0 ? `${h}:${pad(m)}` : `${m}`) + `:${pad(s)}`
}

/**
 * The single persistent "Now Casting" surface (issue #19). A compact bar,
 * present on every view while a cast is active (bottom; above the mobile tab
 * bar). Hovering it (desktop) or tapping the chevron (mobile) slides an
 * accordion up out of the bar with the relative seek buttons and volume — the
 * two things a DLNA/Chromecast session actually needs beyond play/pause.
 *
 * Decoupled from the watch view's browser player: this controls the TV while
 * the browser may be playing a different episode locally.
 */
export default function NowCastingBar({ navigate }: { navigate: Navigate }) {
  const cast = useCastState()
  const dlna = useDlnaState()
  const session = useCastSession()
  const [open, setOpen] = useState(false)
  // While dragging the timeline, show the local value instead of live updates.
  const [seeking, setSeeking] = useState<number | null>(null)
  const closeTimer = useRef<number | null>(null)

  // Only one target is ever connected; DLNA takes precedence if both somehow are.
  const target: 'dlna' | 'chromecast' | null =
    dlna.connected ? 'dlna' : cast.connected ? 'chromecast' : null
  if (!target) return null

  const live = target === 'dlna'
    ? {
        position: dlna.position, duration: dlna.duration, isPaused: dlna.isPaused,
        muted: dlna.muted, volume: dlna.volume, canSeek: true, canControlVolume: true,
        title: dlna.title,
        onSeek: dlnaSeek, onSeekBy: dlnaSeekBy,
        onPlayPause: () => (dlna.isPaused ? dlnaResume() : dlnaPause()),
        onToggleMute: dlnaToggleMute, onSetVolume: dlnaSetVolume, stop: dlnaStop,
      }
    : {
        position: cast.currentTime, duration: cast.duration, isPaused: cast.isPaused,
        muted: cast.muted, volume: cast.volume, canSeek: cast.canSeek,
        canControlVolume: cast.canControlVolume, title: cast.title,
        onSeek: castSeek, onSeekBy: castSeekBy, onPlayPause: castPlayPause,
        onToggleMute: castToggleMute, onSetVolume: castSetVolume, stop: castStop,
      }

  const ep = session?.episode
  const heading = ep?.series_name || live.title || 'Casting'
  const sub = ep
    ? (ep.season === 0 ? ep.title : `S${pad(ep.season)}·E${pad(ep.number)} — ${ep.title}`)
    : (target === 'dlna' ? 'On your TV' : 'On Chromecast')
  const pct = live.duration > 0 ? Math.min(100, (live.position / live.duration) * 100) : 0
  const seekTime = seeking ?? live.position
  function commitSeek() {
    if (seeking === null) return
    live.onSeek(seeking)
    setSeeking(null)
  }

  const clearClose = () => {
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
  }
  const hoverOpen = () => { if (CAN_HOVER) { clearClose(); setOpen(true) } }
  const hoverClose = () => {
    if (!CAN_HOVER) return
    clearClose()
    closeTimer.current = window.setTimeout(() => setOpen(false), 200)
  }

  /** Jump to the watch view of whatever's on the TV (identity from the session). */
  function openSeries() {
    if (!ep) return
    setOpen(false)
    navigate('watch', { u: ep.page_url, t: ep.series_name, p: ep.poster_url, lang: ep.lang, ep: ep.number })
  }

  /** Pull playback back to this browser, resuming where the TV left off. */
  function watchHere() {
    if (!ep) return
    saveProgress(ep, live.position, live.duration)
    requestPullback(getCastQueue() ?? { episodes: [ep], index: 0 })
    live.stop()
  }

  return (
    <div
      onMouseEnter={hoverOpen}
      onMouseLeave={hoverClose}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={hoverClose}
      onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
      className="fixed inset-x-0 md:left-56 z-40 bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0"
    >
      {/* Accordion — grid-rows 0fr→1fr gives a smooth slide-up reveal. */}
      <div className="mx-auto w-full max-w-6xl px-3 md:px-6">
        <div
          className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
            open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">
            <div
              className={`rounded-t-box border border-b-0 border-base-300 bg-base-200/95 backdrop-blur p-3 flex flex-col gap-3 transition-opacity duration-200 motion-reduce:transition-none ${
                open ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {/* Timeline scrubber (absolute seek) */}
              <div>
                <input
                  type="range" min={0} max={live.duration || 0} value={seekTime}
                  disabled={!live.canSeek || !live.duration} aria-label="Seek"
                  onChange={e => setSeeking(Number(e.target.value))}
                  onMouseUp={commitSeek} onTouchEnd={commitSeek}
                  className="range range-primary range-sm w-full"
                />
                <div className="flex justify-between text-xs text-base-content/50 mt-1 font-mono tabular-nums">
                  <span>{fmt(seekTime)}</span>
                  <span>{fmt(live.duration)}</span>
                </div>
              </div>

              {live.canSeek && (
                <div className="grid grid-cols-[auto_repeat(4,minmax(0,1fr))] grid-rows-2 gap-1.5">
                  {/* Play/pause anchors the seek grid, spanning both rows. */}
                  <button
                    onClick={live.onPlayPause}
                    aria-label={live.isPaused ? 'Play' : 'Pause'}
                    className="row-span-2 btn btn-primary rounded-2xl min-h-0 h-full px-5 shadow-sm"
                  >
                    {live.isPaused
                      ? <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                      : <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>}
                  </button>

                  {/* Row 1 — rewind */}
                  {SEEK_MAGS.map(m => (
                    <button
                      key={`back-${m.label}`}
                      onClick={() => live.onSeekBy(-m.seconds)}
                      aria-label={`Back ${m.label}`}
                      className="btn btn-ghost btn-sm min-h-0 h-9 rounded-full bg-base-100 border border-base-300 hover:bg-primary hover:text-primary-content hover:border-primary font-mono gap-0.5 px-2"
                    >
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 7l-5 5 5 5M18 7l-5 5 5 5" />
                      </svg>
                      {m.label}
                    </button>
                  ))}

                  {/* Row 2 — forward */}
                  {SEEK_MAGS.map(m => (
                    <button
                      key={`fwd-${m.label}`}
                      onClick={() => live.onSeekBy(m.seconds)}
                      aria-label={`Forward ${m.label}`}
                      className="btn btn-ghost btn-sm min-h-0 h-9 rounded-full bg-base-100 border border-base-300 hover:bg-primary hover:text-primary-content hover:border-primary font-mono gap-0.5 px-2"
                    >
                      {m.label}
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5-5 5M6 7l5 5-5 5" />
                      </svg>
                    </button>
                  ))}
                </div>
              )}
              {live.canControlVolume && (
                <div className="flex items-center gap-2">
                  <button onClick={live.onToggleMute} aria-label={live.muted ? 'Unmute' : 'Mute'} className="btn btn-ghost btn-square btn-sm">
                    {live.muted ? (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15zM17 9l4 4m0-4l-4 4" /></svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15z M15 9a3 3 0 010 6 M18 6a7 7 0 010 12" /></svg>
                    )}
                  </button>
                  <input
                    type="range" min={0} max={1} step={0.01}
                    value={live.muted ? 0 : live.volume}
                    onChange={e => live.onSetVolume(Number(e.target.value))}
                    aria-label="Volume" className="range range-primary range-sm flex-1"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bar — clicking anywhere on it (except the controls) returns to the
          casting title's watch view. */}
      <div className="border-t border-base-300 bg-base-200/95 backdrop-blur">
        <div
          onClick={openSeries}
          className={`mx-auto w-full max-w-6xl flex items-center gap-3 px-3 md:px-6 py-2 ${
            ep ? 'cursor-pointer hover:bg-base-300/40 transition-colors' : ''
          }`}
        >
          <button onClick={e => { e.stopPropagation(); live.onPlayPause() }} aria-label={live.isPaused ? 'Play' : 'Pause'} className="btn btn-primary btn-circle btn-sm shrink-0">
            {live.isPaused
              ? <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
              : <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>}
          </button>

          {/* Title / now-playing info — part of the bar's click target. */}
          <div className="min-w-0 flex-1">
            <span className="block font-medium truncate">{heading}</span>
            <span className="block text-xs text-base-content/50 truncate">{sub}</span>
          </div>

          <span className="hidden sm:block text-xs font-mono text-base-content/50 tabular-nums whitespace-nowrap shrink-0">
            {fmt(live.position)} / {fmt(live.duration)}
          </span>

          {ep && (
            <button onClick={e => { e.stopPropagation(); watchHere() }} aria-label="Watch here" title="Watch here" className="btn btn-ghost btn-sm btn-square shrink-0">
              {/* Monitor with a play mark — "play on this screen", not a download */}
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="4.5" width="18" height="12" rx="2" strokeLinejoin="round" />
                <path d="M10 8.5l4.5 3-4.5 3z" fill="currentColor" stroke="none" />
                <path d="M8.5 20h7" strokeLinecap="round" />
              </svg>
            </button>
          )}
          <button onClick={e => { e.stopPropagation(); live.stop() }} aria-label="Stop casting" title="Stop casting" className="btn btn-ghost btn-sm btn-square text-error shrink-0">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
          </button>

          {/* Mobile-only accordion toggle (no hover on touch) */}
          <button
            onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
            aria-label={open ? 'Hide controls' : 'Show controls'}
            aria-expanded={open}
            className="btn btn-ghost btn-sm btn-square md:hidden shrink-0"
          >
            <svg className={`w-5 h-5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          </button>
        </div>

        {/* Thin read-only progress line (not a seek control) */}
        <div className="mx-auto w-full max-w-6xl px-3 md:px-6 pb-1.5">
          <div className="h-1 rounded-full bg-base-300 overflow-hidden">
            <div className="h-full bg-primary transition-[width] duration-500 ease-linear" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    </div>
  )
}
