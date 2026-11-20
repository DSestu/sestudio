import { useEffect, useState, type CSSProperties } from 'react'
import { useBrowserPlayerControls } from '../../browserPlayerControls'
import { MINI_PLAYER_FONT_SIZE } from '../../subtitleStyle'
import { sameEpisode, useBrowserSession, useCastSession } from '../../playbackSession'
import { OutPortal } from '../../reversePortal'
import { useBarsHidden } from '../../barsHidden'
import { useMusicBarShown, usePhoneStrip } from '../../phoneStrip'
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
 * a fixed card (desktop, bottom-right) or a strip joined onto the phone dock
 * (mobile). The video element itself is relocated here via the reverse portal, so
 * playback is uninterrupted. Only rendered when off the watch view.
 */
export default function MiniPlayer({ node, onOpen, onClose }: Props) {
  const browser = useBrowserSession()
  const controls = useBrowserPlayerControls()
  const castSession = useCastSession()
  const away = useBarsHidden()
  const music = useMusicBarShown()
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const onChange = () => setDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Handoff: the episode is the one on the TV (local auto-paused) → the cast
  // bar represents it, no mini-player. Mobile shows a single now-playing
  // surface — the cast bar wins when casting.
  const shown = !!browser && !sameEpisode(castSession?.episode, browser.episode) && (desktop || !castSession)
  usePhoneStrip(shown && !desktop)
  // On the music bar: one dock, the video row on top. The bar squares its top corners off.
  const joined = shown && music
  useEffect(() => {
    if (!joined) return
    document.documentElement.style.setProperty('--bar-top-r', '0px')
    return () => { document.documentElement.style.removeProperty('--bar-top-r') }
  }, [joined])
  if (!browser || !shown) return null

  const ep = browser.episode
  const heading = ep.series_name
  const sub = ep.season === 0 ? ep.title : `S${pad(ep.season)}·E${pad(ep.number)} — ${ep.title}`
  const casting = !!castSession
  const failure = controls?.failure ?? null
  const subLine = failure ? <><span className="text-error">Can't play</span> · {failure}</> : sub
  // Only the drop shadow goes: cast onto the bar below it would draw a seam through the dock.
  const seam = joined ? { boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.08)' } : undefined

  const playPause = failure ? (
    <button
      onClick={e => { e.stopPropagation(); controls?.retry() }}
      aria-label="Try again" title="Try again"
      className="btn btn-ghost btn-circle btn-sm shrink-0 border border-white/25"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
    </button>
  ) : (
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
  const video = (extra: string, big: boolean) => (
    <div
      className={`relative bg-black overflow-hidden [contain:paint] ${extra}`}
      style={{ '--media-user-font-size': MINI_PLAYER_FONT_SIZE } as CSSProperties}
    >
      <div className="absolute inset-0 pointer-events-none"><OutPortal node={node} morph /></div>
      {/* The watch view's own error is sized for the page; here a mark says it instead. */}
      {failure && (
        <div className="absolute inset-0 bg-black grid place-items-center text-center text-[11px] leading-tight text-white/75 pointer-events-none">
          <div className="flex flex-col items-center gap-1">
            {/^Subscribers only/.test(failure)
              ? <svg className="w-[18px] h-[18px] text-error" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
              : <svg className="w-[18px] h-[18px] text-error" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><path d="M12 3 2 20h20L12 3z" strokeLinejoin="round" /><path d="M12 10v4M12 17.5v.01" /></svg>}
            {big && <span>{failure.split(':')[0].length <= 18 ? failure.split(':')[0] : "Can't play"}</span>}
          </div>
        </div>
      )}
      <button onClick={onOpen} aria-label="Back to player" className="absolute inset-0" />
    </div>
  )

  if (desktop) {
    return (
      // A floating glass dock centred on the page, above the casting dock when both are up.
      // On the music bar it takes the bar's place and width, sitting on its top edge (bar: h-16 at 1rem + lift).
      <div
        data-mini-player
        className={`fixed z-40 -translate-x-1/2 glass p-2 flex items-center gap-3 ${joined
          ? 'left-1/2 w-[min(36rem,calc(100vw-9rem))] rounded-t-2xl'
          : `left-[calc(6.75rem+(100vw-6.75rem)/2)] w-[min(40rem,calc(100vw-9rem))] rounded-2xl ${casting ? 'bottom-24' : 'bottom-4'}`}`}
        style={joined ? { ...seam, bottom: casting ? '9.5rem' : '5rem' } : undefined}
      >
        {video('w-40 aspect-video rounded-lg shrink-0', true)}
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="block text-sm font-medium truncate">{heading}</span>
          <span className="block text-xs text-base-content/50 truncate">{subLine}</span>
        </button>
        {playPause}
        {close}
      </div>
    )
  }

  return (
    // Sits on the dock's top edge (one glass object with it), under it in
    // stacking so it can rise out from behind it.
    // While the dock is away (scrolling down) it drops into the dock's place.
    <div className={`fixed inset-x-3 z-[39] ${joined ? 'bottom-[calc(var(--dock-top)+4rem)]' : 'bottom-(--dock-top)'} transition-transform duration-300 ease-out motion-reduce:transition-none ${
      away ? 'translate-y-[4.125rem]' : 'translate-y-[calc(-1*var(--discover-lift,0px))]'
    }`}>
      <div data-mini-player style={seam} className={`relative glass transition-[border-radius] duration-300 ${away && !joined ? 'rounded-2xl' : 'rounded-t-2xl'} flex items-center gap-3 pl-2.5 pr-3 py-2.5 animate-dock-rise motion-reduce:animate-none`}>
        {video('w-24 rounded-lg aspect-video shrink-0', false)}
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="block text-sm font-medium truncate">{heading}</span>
          <span className="block text-xs text-base-content/50 truncate">{subLine}</span>
        </button>
        {playPause}
        {close}
      </div>
    </div>
  )
}
