import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAnalysis, useMusicQueue, useTrackInfo } from '../../musicQueue'
import { DEFAULT_HUE, sky } from './format'
import { frameAt, getMode, MODE_MS, ModeMotion, pull, setMode, useMode } from './mode'
import { closePlayer, usePosition } from './player'
import AddPanel from './AddPanel'
import Background from './background/Background'
import { useLook } from './background/settings'
import Queue from './Queue'
import { scrubbing } from './scrub'
import { isPhone } from './timeline/mapping'
import { tlook } from './timeline/render'
import Timeline from './timeline/Timeline'
import Title from './Title'
import Transport from './Transport'

const toggle = () => setMode(getMode() === 'expanded' ? 'default' : 'expanded')

/** Fades a part in or out and keeps a hidden one out of reach. */
function fade(el: HTMLElement | null, o: number, dy: number) {
  if (!el) return
  el.style.opacity = String(o)
  el.style.transform = `translateY(${dy}px)`
  el.style.visibility = o < 0.01 ? 'hidden' : 'visible'
}

/** The full-screen player, over the whole app (rail and dock included). `tv` is the station's picture: the default view, no controls, no sound, no cursor. */
export default function Layer({ tv = false }: { tv?: boolean }) {
  const q = useMusicQueue()
  const info = useTrackInfo(q)
  const item = q.items[q.current]
  const track = item && info(item.track_id)
  const analysis = useAnalysis(item?.track_id)
  const position = usePosition(q, track?.duration ?? 0)
  const touch = useRef<number | null>(null)
  const [adding, setAdding] = useState(false)
  const look = useLook()
  useEffect(() => { Object.assign(tlook, look.tl) }, [look.tl])

  const expanded = useMode() === 'expanded' && !tv
  // The phone's add panel is a sheet over the list, so it goes when the list does.
  const [was, setWas] = useState(expanded)
  if (was !== expanded) {
    setWas(expanded)
    if (!expanded && isPhone(innerWidth)) setAdding(false)
  }
  const motion = useRef<ModeMotion>(null as unknown as ModeMotion)
  motion.current ??= new ModeMotion(expanded ? 1 : 0)
  const progress = useCallback(() => motion.current.value(performance.now()), [])
  const root = useRef<HTMLDivElement>(null)
  const skyEl = useRef<HTMLDivElement>(null)
  const titleEl = useRef<HTMLDivElement>(null)
  const transportEl = useRef<HTMLDivElement>(null)
  const queueEl = useRef<HTMLDivElement>(null)
  const topRow = useRef<HTMLButtonElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const raf = useRef(0)

  // Every part is placed from the one progress value, on the same frame.
  const apply = useCallback((t: number) => {
    const r = root.current
    if (!r) return
    const W = r.clientWidth
    const H = r.clientHeight
    const f = frameAt(W, H, t)
    const { clip: c, title, transport, queue: b } = f
    skyEl.current!.style.clipPath = `inset(${c.y}px ${W - c.x - c.w}px ${H - c.y - c.h}px ${c.x}px round ${c.r}px)`
    const te = titleEl.current!.style
    te.width = `${isPhone(W) ? W - 44 : W - 520}px`
    te.transform = `translate(${title.x}px, ${title.y}px) scale(${title.scale})`
    const tr = transportEl.current!.style
    tr.width = `${transport.w}px`
    tr.transform = `translate(${transport.x}px, ${transport.y}px)`
    const qs = queueEl.current!
    Object.assign(qs.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px`, borderRadius: `${b.r}px` })
    qs.querySelector<HTMLElement>('[data-qglass]')!.style.opacity = String(1 - t)
    qs.querySelector<HTMLElement>('[data-qflat]')!.style.opacity = String(t)
    fade(topRow.current, 1 - t, -14 * t)
    fade(card.current, t, -20 * (1 - t))
  }, [])

  const kick = useCallback(() => {
    if (raf.current) return
    const step = () => {
      const now = performance.now()
      apply(motion.current.value(now))
      raf.current = motion.current.moving(now) ? requestAnimationFrame(step) : 0
    }
    step()
  }, [apply])

  useLayoutEffect(() => {
    apply(motion.current.value(performance.now()))
    return () => cancelAnimationFrame(raf.current)
  }, [apply])
  useEffect(() => {
    window.addEventListener('resize', kick)
    return () => window.removeEventListener('resize', kick)
  }, [kick])

  // A switch retargets from the current progress; reduced motion swaps with a short crossfade instead.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    const m = motion.current
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    m.ms = still ? 0 : MODE_MS
    m.go(expanded ? 1 : 0, performance.now())
    if (still) root.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 })
    kick()
  }, [expanded, kick])

  // Phones (§7.6): swipe the sheet up to open the list; pull the list down past its top to close it.
  useEffect(() => {
    const box = queueEl.current!
    const m = motion.current
    const list = () => box.querySelector<HTMLElement>('[data-list]')!
    const bar = () => box.querySelector<HTMLElement>('[data-bar]')!
    const small = () => isPhone(innerWidth)
    let y0: number | null = null
    let d = 0
    let pulling = false
    let armed = false
    let timer = 0
    const busy = () => !pulling && m.moving(performance.now())
    const pullTo = (to: number) => {
      d = Math.max(0, to)
      const p = pull(d)
      pulling = true
      m.hold(p.t)
      const b = bar()
      b.style.width = `${p.bar}px`
      b.classList.toggle('bg-primary', p.armed)
      if (p.armed && !armed) b.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(2.2)' }, { transform: 'scaleY(1)' }], { duration: 220 })
      armed = p.armed
      kick()
    }
    const release = () => {
      if (!pulling) return
      pulling = false
      const b = bar()
      b.style.width = ''
      b.classList.remove('bg-primary')
      const go = armed
      d = 0
      armed = false
      if (go) setMode('default')
      else { m.go(1, performance.now()); kick() }
    }
    const start = (e: TouchEvent) => { y0 = small() && !busy() ? e.touches[0].clientY : null }
    const move = (e: TouchEvent) => {
      if (y0 === null) return
      const dy = e.touches[0].clientY - y0
      if (getMode() === 'expanded' && (pulling || (list().scrollTop <= 0 && dy > 0))) pullTo(dy)
    }
    const end = (e: TouchEvent) => {
      if (y0 !== null && getMode() === 'default' && y0 - e.changedTouches[0].clientY > 40) setMode('expanded')
      y0 = null
      release()
    }
    const wheel = (e: WheelEvent) => {
      if (!small() || getMode() !== 'expanded' || busy()) return
      if (!pulling && !(e.deltaY < 0 && list().scrollTop <= 0)) return
      e.preventDefault()
      pullTo(d - e.deltaY * 0.6)
      clearTimeout(timer)
      timer = window.setTimeout(release, 180)
    }
    box.addEventListener('touchstart', start, { passive: true })
    box.addEventListener('touchmove', move, { passive: true })
    box.addEventListener('touchend', end)
    box.addEventListener('wheel', wheel, { passive: false })
    return () => {
      clearTimeout(timer)
      box.removeEventListener('touchstart', start)
      box.removeEventListener('touchmove', move)
      box.removeEventListener('touchend', end)
      box.removeEventListener('wheel', wheel)
    }
  }, [kick])

  useEffect(() => {
    if (tv) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePlayer()
      else if (e.key === ' ' && !(e.target as HTMLElement).closest('button, [role=slider], [role=button], input')) {
        e.preventDefault()
        document.querySelector<HTMLButtonElement>('[data-play]')?.click()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tv])

  const closeIcon = <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>

  return (
    <div
      ref={root}
      role="dialog"
      aria-label="Music player"
      className={`fixed inset-0 z-70 overflow-hidden bg-base-100 text-base-content ${tv ? 'pointer-events-none cursor-none select-none' : ''}`}
      // Swipe down closes it on a phone, except from inside the queue (which scrolls).
      onTouchStart={e => { touch.current = (e.target as HTMLElement).closest('[data-queue], [data-addp]') ? null : e.touches[0].clientY }}
      onTouchEnd={e => {
        if (touch.current !== null && !scrubbing() && e.changedTouches[0].clientY - touch.current > 90) closePlayer()
        touch.current = null
      }}
    >
      {/* The sky and the light, clipped to the stage when expanded. */}
      <div ref={skyEl} aria-hidden="true" className="absolute inset-0 -z-30" style={{ background: sky(analysis?.hue ?? DEFAULT_HUE) }}>
        <Background />
      </div>
      {!tv && <button
        ref={topRow}
        aria-label="Close the player"
        onClick={closePlayer}
        className="absolute left-3.5 top-3.5 md:left-8 md:top-4.5 z-10 size-10 rounded-xl glass grid place-items-center"
      >
        {closeIcon}
      </button>}
      {!tv && <div ref={card} className="absolute top-3 left-3.5 right-3.5 md:left-32 md:right-5 z-10 h-16 rounded-2xl glass flex items-center gap-3 px-3 invisible">
        <button aria-label="Close the player" onClick={closePlayer} className="size-10 shrink-0 rounded-xl hover:bg-white/10 grid place-items-center">{closeIcon}</button>
        <div className="min-w-0 leading-tight">
          <b className="block truncate text-[15px]">{track?.title ?? ''}</b>
          <span className="block truncate text-xs text-primary">{track?.artist ?? ''}</span>
        </div>
      </div>}
      <div ref={titleEl} className="absolute left-0 top-0 min-w-0 origin-top-left">
        <Title info={track} analysis={analysis} />
      </div>
      <Timeline q={q} info={info} palette={look.tlPal} progress={progress} onOutside={() => setAdding(false)} />
      <div ref={transportEl} className="absolute left-0 top-0">
        <Transport q={q} position={position} duration={track?.duration ?? 0} tv={tv} />
      </div>
      <div ref={queueEl} className="absolute">
        <Queue q={q} info={info} adding={adding} onAdd={() => setAdding(a => !a)} expanded={expanded} onPin={toggle} tv={tv} />
      </div>
      {adding && !tv && <AddPanel q={q} onClose={() => setAdding(false)} />}
    </div>
  )
}
