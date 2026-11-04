import VolumePill from './VolumePill'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAnalysis, useMusicQueue, useTrackInfo } from '../../musicQueue'
import { DEFAULT_HUE, sky } from './format'
import { frameAt, getMode, titleWidth, MODE_MS, ModeMotion, pull, setMode, useMode } from './mode'
import { closePlayer, closeThen, usePosition, useTvSound } from './player'
import PlayerSearch from './PlayerSearch'
import Crate, { LibraryList } from './Crate'
import { wake } from './idle'
import ToastBar from './ToastBar'
import Background from './background/Background'
import { useLook } from './background/settings'
import Queue from './Queue'
import { scrubbing } from './scrub'
import { isPhone, isShort, libRect, libShift, rects, setStageShift } from './timeline/mapping'
import { tlook } from './timeline/render'
import Timeline from './timeline/Timeline'
import Title from './Title'
import Transport from './Transport'
import { useModalBack } from '../../useModalBack'

const toggle = () => setMode(getMode() === 'expanded' ? 'default' : 'expanded')

/** Fades a part in or out and keeps a hidden one out of reach. */
function fade(el: HTMLElement | null, o: number, dy: number) {
  if (!el) return
  el.style.opacity = String(o)
  el.style.transform = `translateY(${dy}px)`
  el.style.visibility = o < 0.01 ? 'hidden' : 'visible'
}

/** The station's page: the TV's picture, with its unheard sound for the light. */
export function TvLayer() {
  useTvSound()
  return <Layer tv />
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

  const [aim, setAim] = useState<number | null>(null)
  const [vw, setVw] = useState({ W: innerWidth, H: innerHeight })
  const expanded = useMode() === 'expanded' && !tv
  // Each mode has its own place to add from (the crate, the column, the Library page): a switch closes it.
  const [was, setWas] = useState(expanded)
  if (was !== expanded) {
    setWas(expanded)
    setAdding(false)
    setAim(null)
  }
  const small = isPhone(vw.W) || isShort(vw.W, vw.H)
  // The desktop's expanded view opens the library as a column beside the queue; phones get a Library page.
  const column = expanded && adding && !small
  const tabs = expanded && small
  const [colMounted, setColMounted] = useState(false)
  if (column && !colMounted) setColMounted(true)
  const closeAdding = useCallback(() => { setAdding(false); setAim(null) }, [])
  const toggleAdding = useCallback(() => { setAdding(a => !a); setAim(null) }, [])
  const aimObj = { at: aim, set: setAim }
  const aimTitle = aim !== null && aim > 0 ? info(q.items[aim - 1]?.track_id ?? '')?.title : undefined
  const motion = useRef<ModeMotion>(null as unknown as ModeMotion)
  motion.current ??= new ModeMotion(expanded ? 1 : 0)
  const lib = useRef<ModeMotion>(null as unknown as ModeMotion)
  lib.current ??= Object.assign(new ModeMotion(0), { ms: 320 })
  const libEl = useRef<HTMLDivElement>(null)
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
    // The library column takes its room from the stage as it opens.
    const lv = lib.current.value(performance.now())
    setStageShift(isPhone(W) || isShort(W, H) ? 0 : libShift(W) * lv * t)
    const le = libEl.current
    if (le) {
      const c = libRect(W, H)
      Object.assign(le.style, {
        left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px`,
        opacity: String(lv), transform: `translateX(${(1 - lv) * 24}px)`, visibility: lv < 0.01 ? 'hidden' : 'visible',
      })
    }
    wake()
    const f = frameAt(W, H, t)
    const { clip: c, title, transport, queue: b } = f
    skyEl.current!.style.clipPath = `inset(${c.y}px ${W - c.x - c.w}px ${H - c.y - c.h}px ${c.x}px round ${c.r}px)`
    const te = titleEl.current!.style
    te.width = `${titleWidth(W, H, title.x)}px`
    te.transform = `translate(${title.x}px, ${title.y}px) scale(${title.scale})`
    const tr = transportEl.current!.style
    tr.width = `${transport.w}px`
    tr.transform = `translate(${transport.x}px, ${transport.y}px)`
    const qs = queueEl.current!
    Object.assign(qs.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px`, borderRadius: `${b.r}px` })
    qs.querySelector<HTMLElement>('[data-qglass]')!.style.opacity = String(1 - t)
    qs.querySelector<HTMLElement>('[data-qflat]')!.style.opacity = String(t)
    // Too short for the top card: the title stays put and so does the close button.
    const short = isShort(W, H)
    fade(topRow.current, short ? 1 : 1 - t, short ? 0 : -14 * t)
    fade(card.current, short ? 0 : t, -20 * (1 - t))
  }, [])

  const kick = useCallback(() => {
    if (raf.current) return
    const step = () => {
      const now = performance.now()
      apply(motion.current.value(now))
      raf.current = motion.current.moving(now) || lib.current.moving(now) ? requestAnimationFrame(step) : 0
    }
    step()
  }, [apply])

  useLayoutEffect(() => {
    apply(motion.current.value(performance.now()))
    return () => cancelAnimationFrame(raf.current)
  }, [apply])
  useEffect(() => {
    const on = () => { setVw({ W: innerWidth, H: innerHeight }); kick() }
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [kick])

  // The column slides in (and the stage narrows), or out, then unmounts.
  useLayoutEffect(() => {
    if (tv) return
    lib.current.go(column ? 1 : 0, performance.now())
    kick()
    if (column) return
    const id = window.setTimeout(() => setColMounted(false), 340)
    return () => window.clearTimeout(id)
  }, [column, colMounted, tv, kick])
  useEffect(() => () => setStageShift(0), [])

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

  // Desktops: drag up anywhere to open the expanded view, drag the stage down to come back.
  // The parts follow the pointer; a release past 30% of the way switches.
  useEffect(() => {
    if (tv) return
    const el = root.current!
    const m = motion.current
    const SPAN = 240
    let p: { x: number; y: number; from: number; on: boolean; t: number } | null = null
    const down = (e: PointerEvent) => {
      // shortcut: mouse and pen only, as a touch swipe down already closes the layer; give touch screens their own gesture if wanted.
      if (isPhone(innerWidth) || e.pointerType === 'touch' || e.button !== 0 || m.moving(performance.now())) return
      if ((e.target as Element).closest('button, input, a, textarea, [role=slider], [data-queue], [data-addp], [data-mix-popover]')) return
      const from = getMode() === 'expanded' ? 1 : 0
      if (from) {
        const { e: s } = rects(el.clientWidth, el.clientHeight)
        if (e.clientX < s.x || e.clientX > s.x + s.w || e.clientY < s.y || e.clientY > s.y + s.h) return
      }
      p = { x: e.clientX, y: e.clientY, from, on: false, t: from }
    }
    const move = (e: PointerEvent) => {
      if (!p) return
      const dx = Math.abs(e.clientX - p.x)
      const dy = Math.abs(e.clientY - p.y)
      if (!p.on) {
        if (Math.max(dx, dy) < 8) return
        // A sideways drag is a scrub.
        if (dx >= dy) { p = null; return }
        p.on = true
        el.style.userSelect = 'none'
        getSelection()?.removeAllRanges()
      }
      p.t = Math.min(1, Math.max(0, p.from + (p.y - e.clientY) / SPAN))
      m.hold(p.t)
      kick()
    }
    const up = () => {
      const d = p
      p = null
      if (!d?.on) return
      el.style.userSelect = ''
      if (Math.abs(d.t - d.from) > 0.3) setMode(d.from ? 'default' : 'expanded')
      else { m.go(d.from, performance.now()); kick() }
    }
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [tv, kick])

  // Back closes the player instead of navigating the page under it.
  useModalBack(!tv, closePlayer)

  // A modal: focus moves in, and on close focus goes to the player bar, which takes the layer's place.
  useEffect(() => {
    const el = root.current
    if (tv || !el) return
    // After the first frame has placed the parts: the close button shown depends on the mode.
    const f = requestAnimationFrame(() => {
      const close = [...el.querySelectorAll<HTMLElement>('[aria-label="Close the player"]')].find(b => b.checkVisibility({ visibilityProperty: true }))
      close?.focus({ preventScroll: true })
    })
    return () => {
      cancelAnimationFrame(f)
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-label="Open the player"]')?.focus({ preventScroll: true }))
    }
  }, [tv])

  // The app behind is out of reach, except the desktop rail in the expanded view:
  // it shows beside the stage, and a pick there closes the player onto the new page.
  const withRail = expanded && !isPhone(innerWidth)
  useEffect(() => {
    const el = root.current
    if (tv || !el?.parentElement) return
    const rail = withRail ? document.querySelector<HTMLElement>('[data-rail]') : null
    const shut: HTMLElement[] = []
    const visit = (parent: Element) => {
      for (const c of parent.children) {
        if (c === el || c === rail || !(c instanceof HTMLElement) || c.inert) continue
        if (rail && c.contains(rail)) visit(c)
        else shut.push(c)
      }
    }
    visit(el.parentElement)
    shut.forEach(c => { c.inert = true })
    // The pick is held until the player is closed, then replayed, so closing does not undo its navigation.
    const pick = (e: MouseEvent) => {
      const t = (e.target as Element).closest<HTMLElement>('button, a')
      if (!t) return
      e.preventDefault()
      e.stopPropagation()
      closeThen(() => t.click())
    }
    if (rail) {
      rail.style.zIndex = '80'
      rail.addEventListener('click', pick, true)
    }
    return () => {
      shut.forEach(c => { c.inert = false })
      if (rail) {
        rail.style.zIndex = ''
        rail.removeEventListener('click', pick, true)
      }
    }
  }, [tv, withRail])

  useEffect(() => {
    if (tv) return
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')
      if (e.key === 'Escape') {
        if (adding) closeAdding()
        else closePlayer()
      } else if ((e.key === 'a' || e.key === 'A') && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        toggleAdding()
      } else if (e.key === ' ' && !(e.target as HTMLElement).closest('button, [role=slider], [role=button], input')) {
        e.preventDefault()
        document.querySelector<HTMLButtonElement>('[data-play]')?.click()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tv, adding, closeAdding, toggleAdding])

  const closeIcon = <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>

  return (
    <div
      ref={root}
      role="dialog"
      aria-label="Music player"
      aria-modal={!tv || undefined}
      className={`music-layer fixed inset-0 z-70 overflow-hidden bg-base-100 text-base-content select-none ${tv ? 'pointer-events-none cursor-none' : ''}`}
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
        className="absolute left-3.5 top-3.5 md:left-8 md:top-4.5 short:left-4 short:top-3.5 z-10 size-10 rounded-xl glass grid place-items-center"
      >
        {closeIcon}
      </button>}
      {!tv && <div ref={card} className="absolute top-3 left-3.5 right-3.5 md:left-32 md:right-5 z-10 h-16 rounded-2xl glass flex items-center gap-3 px-3 invisible">
        <button aria-label="Close the player" onClick={closePlayer} className="size-10 shrink-0 rounded-xl hover:bg-white/10 grid place-items-center">{closeIcon}</button>
        <h2 className="max-md:hidden shrink-0 pr-2 text-xl font-medium">Music</h2>
        <PlayerSearch active={expanded} />
        <button
          aria-label="Activity"
          onClick={() => closeThen(() => { window.location.hash = '#/notifications' })}
          className="max-md:hidden ml-auto size-10 shrink-0 rounded-xl bg-white/6 hover:bg-white/10 grid place-items-center"
        >
          <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 16v-5a6 6 0 10-12 0v5l-2 2h16zM10 21h4" /></svg>
        </button>
      </div>}
      <div ref={titleEl} className="absolute left-0 top-0 min-w-0 origin-top-left">
        <Title info={track} analysis={analysis} />
      </div>
      <Timeline
        q={q}
        info={info}
        palette={look.tlPal}
        progress={progress}
        onOutside={closeAdding}
        marks={adding && !tv}
        aim={aim}
        onAim={at => { setAim(at); setAdding(true) }}
      />
      <div ref={transportEl} className="absolute left-0 top-0">
        <Transport q={q} position={position} duration={track?.duration ?? 0} tv={tv} />
      </div>
      <div ref={queueEl} className="absolute">
        <Queue
          q={q}
          info={info}
          adding={adding}
          onAdd={toggleAdding}
          expanded={expanded}
          onPin={toggle}
          tv={tv}
          library={tabs ? <LibraryList q={q} aim={aimObj} aimTitle={aimTitle} /> : undefined}
        />
      </div>
      {!tv && colMounted && (
        <div ref={libEl} data-addp aria-label="Add to queue" className="absolute flex flex-col overflow-hidden rounded-lg bg-base-200 pt-2 invisible" style={{ ['--rowbg' as string]: 'var(--color-base-200)' }}>
          <LibraryList q={q} aim={aimObj} aimTitle={aimTitle} head={<h3 className="shrink-0 text-[13px] font-semibold">Add from</h3>} onClose={closeAdding} />
        </div>
      )}
      {tv && <VolumePill />}
      {adding && !tv && !expanded && <Crate q={q} aim={aimObj} aimTitle={aimTitle} onClose={closeAdding} />}
      {!tv && <ToastBar />}
    </div>
  )
}
