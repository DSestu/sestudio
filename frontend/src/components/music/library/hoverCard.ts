import { useCallback, useEffect, useRef, useState } from 'react'
import type { MusicTrack } from '../../../musicLibrary'

// The hover card's timing (SPEC-music-library §2.4): mouse only, 180 ms, swaps at once between tracks.

export const HOVER_MS = 180

export interface Hover { t: MusicTrack; rect: DOMRect }

/** Enter / leave handlers for anything that shows the card, and the card's state. */
export function useHoverCard() {
  const [hover, setHover] = useState<Hover | null>(null)
  const timer = useRef(0)
  const open = useRef(false)
  useEffect(() => { open.current = !!hover }, [hover])
  const enter = useCallback((t: MusicTrack, el: Element, pointerType: string) => {
    if (pointerType !== 'mouse') return
    window.clearTimeout(timer.current)
    const show = () => setHover({ t, rect: el.getBoundingClientRect() })
    if (open.current) show()
    else timer.current = window.setTimeout(show, HOVER_MS)
  }, [])
  const leave = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setHover(null), 120)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  /** Props for a hoverable element. */
  const props = useCallback((t: MusicTrack) => ({
    onPointerEnter: (e: React.PointerEvent) => enter(t, e.currentTarget, e.pointerType),
    onPointerLeave: leave,
  }), [enter, leave])
  return { hover, props, hide: () => setHover(null) }
}
