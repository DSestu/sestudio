import { useEffect, useState, type CSSProperties } from 'react'
import { useBrowserPlayerControls } from '../../browserPlayerControls'
import { MINI_PLAYER_FONT_SIZE } from '../../subtitleStyle'
import { sameEpisode, useBrowserSession, useCastSession } from '../../playbackSession'
import { OutPortal } from '../../reversePortal'
import type { PortalNode } from '../../portalNode'

const pad = (n: number) => String(n).padStart(2, '0')

interface Props {
  node: PortalNode
  /** Re-open the full watch view for the playing title. */
  onOpen: () => void
  /** Stop local playback and dismiss (the ✕). */
  onClose: () => void
}

/**
 * Minimised browser player (issue #20). Shows the still-playing local video as
 * a fixed card (desktop, bottom-right) or a docked strip (mobile, above the tab
 * bar). The video element itself is relocated here via the reverse portal, so
 * playback is uninterrupted. Only rendered when off the watch view.
 */
export default function MiniPlayer({ node, onOpen, onClose }: Props) {
  const browser = useBrowserSession()
  const controls = useBrowserPlayerControls()
  const castSession = useCastSession()
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const onChange = () => setDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  if (!browser) return null
  // Handoff: the episode is the one on the TV (local auto-paused) → the cast
  // bar represents it, no mini-player.
  if (sameEpisode(castSession?.episode, browser.episode)) return null
  // Mobile shows a single now-playing surface — the cast bar wins when casting.
  if (!desktop && castSession) return null

  const ep = browser.episode
  const heading = ep.series_name
  const sub = ep.season === 0 ? ep.title : `S${pad(ep.season)}·E${pad(ep.number)} — ${ep.title}`
  const casting = !!castSession

  const playPause = (
    <button
      onClick={e => { e.stopPropagation(); controls?.playPause() }}
      aria-label={controls?.isPaused ? 'Play' : 'Pause'}
      className="btn btn-primary btn-circle btn-sm shrink-0"
    >
      {controls?.isPaused
        ? <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
        : <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>}
    </button>
  )
  const close = (
    <button
      onClick={e => { e.stopPropagation(); onClose() }}
      aria-label="Stop" title="Stop"
      className="btn btn-ghost btn-sm btn-square text-error shrink-0"
    >
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
    </button>
  )

  // The video (with its own controls) is disabled for pointer input in the
  // mini surface; a full-cover button re-opens the watch view instead.
  // The caption size is overridden on this container rather than globally: the
  // portalled player is the *same* instance as the watch view's, so a scoped
  // variable is what distinguishes the two surfaces. It reverts by itself when
  // the player portals back out.
  const video = (extra: string) => (
    <div
      className={`relative bg-black overflow-hidden ${extra}`}
      style={{ '--media-user-font-size': MINI_PLAYER_FONT_SIZE } as CSSProperties}
    >
      <div className="absolute inset-0 pointer-events-none"><OutPortal node={node} morph /></div>
      <button onClick={onOpen} aria-label="Back to player" className="absolute inset-0" />
    </div>
  )

  if (desktop) {
    return (
      <div className={`fixed right-4 z-40 w-80 rounded-box overflow-hidden border border-base-300 bg-base-200 shadow-xl ${casting ? 'bottom-[5.5rem]' : 'bottom-4'}`}>
        {video('aspect-video')}
        <div className="flex items-center gap-2 px-2 py-1.5">
          {playPause}
          <button onClick={onOpen} className="min-w-0 flex-1 text-left">
            <span className="block text-sm font-medium truncate">{heading}</span>
            <span className="block text-xs text-base-content/50 truncate">{sub}</span>
          </button>
          {close}
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-x-0 z-40 bottom-[calc(4rem+env(safe-area-inset-bottom))] border-t border-base-300 bg-base-200/95 backdrop-blur">
      <div className="flex items-center gap-3 px-3 py-2">
        {video('w-24 rounded aspect-video shrink-0')}
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="block text-sm font-medium truncate">{heading}</span>
          <span className="block text-xs text-base-content/50 truncate">{sub}</span>
        </button>
        {playPause}
        {close}
      </div>
    </div>
  )
}
