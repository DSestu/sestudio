import VolumePill from './VolumePill'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useAnalysis, useMusicQueue, useTrackInfo } from '../../musicQueue'
import { DEFAULT_HUE, sky } from './format'
import { frameAt, getMode, titleWidth, MODE_MS, ModeMotion, pull, setMode, useMode } from './mode'
import { closePlayer, closeThen, usePosition, useTvSound } from './player'
import PlayerSearch from './PlayerSearch'
import Crate, { LibraryList } from './Crate'
import { wake } from './idle'
import { joins } from './joins'
import ToastBar from './ToastBar'
import Background from './background/Background'
import { useLook } from './background/settings'
import Queue from './Queue'
import { scrubbing } from './scrub'
import { crateHeight, isPhone, isShort, libRect, libShift, PHONE_LIFT, rects, setStageLift, setStageShift } from './timeline/mapping'
import { tlook } from './timeline/render'
import Timeline from './timeline/Timeline'
import Title from './Title'
import { SearchIcon } from '../search/SearchParts'
import Transport from './Transport'
import { useModalBack } from '../../useModalBack'

const toggle = () => setMode(getMode() === 'expanded' ? 'default' : 'expanded')
const toDefault = () => setMode('default')

/** Fades a part in or out and keeps a hidden one out of reach. */
function fade(el: HTMLElement | null, o: number, dy: number) {
  if (!el) return
  el.style.opacity = String(o)
  el.style.transform = `translateY(${dy}px)`
  el.style.visibility = o < 0.01 ? 'hidden' : 'visible'
}

/** Fades a part without moving it. */
function dim(el: HTMLElement | null, o: number) {
  if (!el) return
  el.style.opacity = String(o)
  el.style.visibility = o < 0.01 ? 'hidden' : ''
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** The default view's crate: closed, peeking (a pointer at the bottom edge or on Add to queue), open (the pointer on it), or pinned (a click, a key, a tap). */
type Reveal = 'off' | 'peek' | 'open' | 'pinned'
const RISE = { off: 0, peek: 0.25, open: 1, pinned: 1 }
const RISE_MS = { off: 420, peek: 300, open: 560, pinned: 560 }

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
  const [reveal, setReveal] = useState<Reveal>('off')
  const adding = reveal !== 'off'
  const look = useLook()
  useEffect(() => { Object.assign(tlook, look.tl) }, [look.tl])

  const [aim, setAim] = useState<number | null>(null)
  // Desktop, expanded: hovering the queue peeks the library column open; the Library button (or A) locks it (`adding`).
  const [peek, setPeek] = useState(false)
  const [finding, setFinding] = useState(false)
  const [vw, setVw] = useState({ W: innerWidth, H: innerHeight })
  const expanded = useMode() === 'expanded' && !tv
  // Each mode has its own place to add from (the crate, the column, the Library page): a switch closes it.
  const [was, setWas] = useState(expanded)
  if (was !== expanded) {
    setWas(expanded)
    setReveal('off')
    setPeek(false)
    setFinding(false)
    setAim(null)
  }
  const small = isPhone(vw.W) || isShort(vw.W, vw.H)
  // The desktop's expanded view opens the library as a column beside the queue; phones get a Library page.
  const column = expanded && !small && (adding || peek)
  const tabs = expanded && small
  const [colMounted, setColMounted] = useState(false)
  if (column && !colMounted) setColMounted(true)
  const closeAdding = useCallback(() => { setReveal('off'); setPeek(false); setAim(null) }, [])
  const peekTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(peekTimer.current), [])
  // A mouse resting on the queue (or the column) for 250 ms opens it; leaving both for 350 ms closes it, unless locked or a drag is under way.
  const hoverIn = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse' || !expanded || small) return
    window.clearTimeout(peekTimer.current)
    if (!peek) peekTimer.current = window.setTimeout(() => setPeek(true), 250)
  }
  const hoverOut = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse') return
    window.clearTimeout(peekTimer.current)
    const close = () => {
      if (joins.dragging) peekTimer.current = window.setTimeout(close, 300)
      else setPeek(false)
    }
    peekTimer.current = window.setTimeout(close, 350)
  }
  // The crate stays mounted while the stage falls back over it.
  const [crateMounted, setCrateMounted] = useState(false)
  if (adding && !expanded && !crateMounted) setCrateMounted(true)
  // A peeking crate is pinned rather than closed.
  const toggleAdding = useCallback(() => { setReveal(r => (r === 'pinned' ? 'off' : 'pinned')); setAim(null) }, [])
  const aimObj = { at: aim, set: setAim }
  const aimTitle = aim !== null && aim > 0 ? info(q.items[aim - 1]?.track_id ?? '')?.title : undefined
  const motion = useRef<ModeMotion>(null as unknown as ModeMotion)
  motion.current ??= new ModeMotion(expanded ? 1 : 0)
  const lib = useRef<ModeMotion>(null as unknown as ModeMotion)
  lib.current ??= Object.assign(new ModeMotion(0), { ms: 320 })
  const rise = useRef<ModeMotion>(null as unknown as ModeMotion)
  rise.current ??= new ModeMotion(0)
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
    // The crate (default view): the stage rises in tiers to uncover it, bottom first, and nothing leaves the screen.
    // A desktop lifts the timeline by the crate's height, the transport after it, the title shrinking to a headline,
    // and shortens the queue; a phone lifts the timeline a little and its controls slide up under it, fading.
    const R = crateHeight(W, H)
    const k = R ? rise.current.value(performance.now()) * (1 - t) : 0
    const k1 = clamp01((k - 0.08) / 0.92)
    const k2 = clamp01((k - 0.16) / 0.84)
    const phone = isPhone(W)
    setStageLift(phone ? PHONE_LIFT * k1 : R * k)
    if (phone) {
      title.y -= 130 * k2
      transport.y -= 230 * k1
      b.y -= 360 * k
    } else {
      title.y -= 70 * k2
      title.scale *= 1 - 0.45 * k2
      transport.y -= 112 * k1
      // Not while peeking: the Add to queue row stays under the pointer that is resting on it.
      b.h -= 196 * clamp01((k - RISE.peek) / (1 - RISE.peek))
    }
    dim(titleEl.current, phone ? clamp01(1 - 1.2 * k2) : 1)
    dim(transportEl.current, phone ? clamp01(1 - 1.3 * k1) : 1)
    dim(queueEl.current, phone ? clamp01(1 - 1.4 * k) : 1)
    skyEl.current!.style.clipPath = `inset(${c.y}px ${W - c.x - c.w}px ${H - c.y - c.h + R * k}px ${c.x}px round ${c.r}px)`
    const te = titleEl.current!.style
    te.width = `${titleWidth(W, H, title.x, t)}px`
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
      raf.current = motion.current.moving(now) || lib.current.moving(now) || rise.current.moving(now) ? requestAnimationFrame(step) : 0
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

  // The stage rises over the crate, or falls back, then the crate unmounts.
  useLayoutEffect(() => {
    if (tv) return
    const r = rise.current
    r.go(expanded ? 0 : RISE[reveal], performance.now())
    r.ms = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : RISE_MS[reveal]
    kick()
    if (reveal !== 'off' && !expanded) return
    const id = window.setTimeout(() => setCrateMounted(false), RISE_MS.off + 20)
    return () => window.clearTimeout(id)
  }, [reveal, expanded, tv, kick])
  useEffect(() => () => setStageLift(0), [])

  // Desktops: the crate deploys on hover. The bottom edge (or a rest on Add to queue) peeks, the pointer on the crate
  // opens it, and 400 ms away it falls back; a press in it, or its search taking focus, pins it.
  const revealNow = useRef(reveal)
  revealNow.current = reveal
  // Phones: while a library row is held (rowDrag's data-libdrag), the stage falls back over the crate so the row drops into the queue sheet or on a join.
  useEffect(() => {
    if (tv) return
    const html = document.documentElement
    const obs = new MutationObserver(() => {
      if (!isPhone(innerWidth) || getMode() === 'expanded' || revealNow.current === 'off') return
      rise.current.go(html.dataset.libdrag ? 0 : RISE[revealNow.current], performance.now())
      kick()
    })
    obs.observe(html, { attributes: true, attributeFilter: ['data-libdrag'] })
    return () => obs.disconnect()
  }, [tv, kick])
  useEffect(() => {
    if (tv || expanded || small || !window.matchMedia('(hover: hover)').matches) return
    let leave = 0
    let rest = 0
    const stay = () => { clearTimeout(leave); leave = 0 }
    const away = () => { if (!leave) leave = window.setTimeout(() => { leave = 0; setReveal(r => (r === 'pinned' ? r : 'off')) }, 400) }
    const move = (e: PointerEvent) => {
      const cur = revealNow.current
      if (e.pointerType !== 'mouse' || e.buttons || cur === 'pinned') return
      const el = e.target as Element
      const lip = e.clientY > innerHeight - 24
      const row = !!el.closest?.('[data-add-row]')
      const top = innerHeight - crateHeight(innerWidth, innerHeight) * RISE[cur]
      const onCrate = cur !== 'off' && (!!el.closest?.('[data-addp]') || e.clientY > top - 8)
      if (!row) { clearTimeout(rest); rest = 0 }
      if (lip || row || onCrate) stay()
      if (cur === 'off') {
        if (lip) setReveal('peek')
        else if (row && !rest) rest = window.setTimeout(() => { rest = 0; setReveal(r => (r === 'off' ? 'peek' : r)) }, 150)
      } else if (onCrate && cur === 'peek') setReveal('open')
      else if (!lip && !row && !onCrate) away()
    }
    const out = (e: PointerEvent) => { if (!e.relatedTarget && revealNow.current !== 'pinned' && revealNow.current !== 'off') away() }
    const pin = (e: Event) => {
      if (revealNow.current !== 'off' && (e.target as Element).closest?.('[data-addp]')) setReveal('pinned')
    }
    window.addEventListener('pointermove', move)
    document.addEventListener('pointerout', out)
    window.addEventListener('pointerdown', pin, true)
    window.addEventListener('focusin', pin)
    return () => {
      stay()
      clearTimeout(rest)
      window.removeEventListener('pointermove', move)
      document.removeEventListener('pointerout', out)
      window.removeEventListener('pointerdown', pin, true)
      window.removeEventListener('focusin', pin)
    }
  }, [tv, expanded, small])

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
      b.toggleAttribute('data-armed', p.armed)
      if (p.armed && !armed) b.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(2.2)' }, { transform: 'scaleY(1)' }], { duration: 220 })
      armed = p.armed
      kick()
    }
    const release = () => {
      if (!pulling) return
      pulling = false
      const b = bar()
      b.style.width = ''
      b.removeAttribute('data-armed')
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

  // Back closes the player instead of navigating the page under it; on a phone, the expanded view first goes back down to the default one.
  useModalBack(!tv, closePlayer)
  useModalBack(!tv && expanded && isPhone(vw.W) && !isShort(vw.W, vw.H), toDefault)

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
        // One height at a time: from the expanded view a swipe down goes back to the default one.
        if (touch.current !== null && !scrubbing() && e.changedTouches[0].clientY - touch.current > 90) (getMode() === 'expanded' ? toDefault() : closePlayer())
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
        {/* A phone keeps the list's room: the search is an icon until tapped. */}
        {isPhone(vw.W) && !finding
          ? <button aria-label="Search" onClick={() => setFinding(true)} className="ml-auto size-10 shrink-0 rounded-xl bg-white/6 hover:bg-white/10 grid place-items-center"><SearchIcon /></button>
          : <PlayerSearch active={expanded} autoFocus={finding} />}
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
        marks={(adding || column) && !tv}
        aim={aim}
        onAim={at => { setAim(at); setReveal('pinned') }}
      />
      <div ref={transportEl} className="absolute left-0 top-0">
        <Transport q={q} position={position} duration={track?.duration ?? 0} tv={tv} compact={expanded && isPhone(vw.W) && !isShort(vw.W, vw.H)} />
      </div>
      <div ref={queueEl} className="absolute" onPointerEnter={hoverIn} onPointerLeave={hoverOut}>
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
        <div ref={libEl} data-addp aria-label="Add to queue" onPointerEnter={hoverIn} onPointerLeave={hoverOut} className="absolute flex flex-col overflow-hidden rounded-lg bg-base-200 pt-2 invisible" style={{ ['--rowbg' as string]: 'var(--color-base-200)' }}>
          <LibraryList q={q} aim={aimObj} aimTitle={aimTitle} head={<h3 className="shrink-0 text-[13px] font-semibold">Add from</h3>} onClose={closeAdding} rail />
        </div>
      )}
      {tv && <VolumePill />}
      {crateMounted && (adding || crateHeight(vw.W, vw.H) > 0) && !tv && !expanded && <Crate q={q} aim={aimObj} aimTitle={aimTitle} onClose={closeAdding} />}
      {!tv && <ToastBar />}
    </div>
  )
}
