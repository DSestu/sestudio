import { useSyncExternalStore } from 'react'
import { clockSkew, positionNow, type QueueItem, type QueueState, type TrackInfo } from '../../musicQueue'
import { planBetween } from './mix/analysis'
import { lockPhase } from './mix/lock'
import type { Plan } from './timeline/sampling'
import { TV } from './tv'

// The audio graph and blend rules of SPEC-music-player §9. The queue on the
// server is the source of truth: this engine only follows its state.
//
// One tab makes the sound: the most recent one where the user pressed play.
// Every other tab mirrors the queue on screen and stays silent (see
// claimSound / isSoundTab).

/** Blend lengths in seconds. */
export const BLEND = {
  /** Next / previous. */
  skip: 3,
  /** Row click, a track picked from elsewhere. */
  glide: 0.6,
  /** The automatic transition at the end of a track. */
  auto: 4,
}
const CURVE_POINTS = 48
/** The low shelf that swaps the two basses during a beat sync. */
const SHELF_HZ = 180
const SHELF_DB = -26
/** The incoming tempo returns to its own over this many beats of it. */
const GLIDE_BEATS = 32
/** A clock further than this from the element's own is a seek from elsewhere. */
const DRIFT = 1

/** Equal-power gain curves: `out` falls from *from* along cos, `inn` rises along sin. */
export function blendCurves(from = 1, n = CURVE_POINTS): { out: Float32Array; inn: Float32Array } {
  const out = new Float32Array(n)
  const inn = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = i / (n - 1)
    out[i] = from * Math.cos((p * Math.PI) / 2)
    inn[i] = Math.sin((p * Math.PI) / 2)
  }
  return { out, inn }
}

// --- which tab plays ---------------------------------------------------------

const SOUND_KEY = 'music.soundTab'
const TAB_ID = Math.random().toString(36).slice(2)

/** This tab takes over the sound; the tab that had it goes quiet. */
export function claimSound() {
  localStorage.setItem(SOUND_KEY, TAB_ID)
}
// The TV page plays too, unheard (its browser is muted): the light needs an analyser to read.
export const isSoundTab = () => TV || (!onTv && localStorage.getItem(SOUND_KEY) === TAB_ID)

// While the queue plays on a TV the sound is the TV's only.
let onTv = false
export const setSoundOnTv = (v: boolean) => { onTv = v }

// --- this device's volume ------------------------------------------------------

const VOL_KEY = 'music.volume'
/** 0..100 and mute, kept per device; the gain is (level / 100)², a perceptual curve (as the TV's). */
let vol = { level: Math.max(0, Math.min(100, Number(localStorage.getItem(VOL_KEY) ?? 100) || 0)), muted: false }
const volListeners = new Set<() => void>()
const gainOf = () => (vol.muted ? 0 : (vol.level / 100) ** 2)
export const useVolume = () => useSyncExternalStore(l => { volListeners.add(l); return () => volListeners.delete(l) }, () => vol)
export function setVolume(next: Partial<typeof vol>) {
  vol = { ...vol, ...next }
  localStorage.setItem(VOL_KEY, String(vol.level))
  engine.applyVolume()
  volListeners.forEach(l => l())
}

// --- the engine --------------------------------------------------------------

interface Fade {
  from: number
  to: number
  itemId: string
  end: number
  plan?: Plan
}

/** What a running beat sync shows: both tempos, the pair, the phase error. */
export interface SyncStatus {
  pair: string
  from: number
  to: number
  errMs: number | null
  locked: boolean
}

let syncStatus: SyncStatus | null = null
const syncListeners = new Set<() => void>()
function setSync(s: SyncStatus | null) {
  const o = syncStatus
  if (o === s || (o && s && o.pair === s.pair && o.locked === s.locked && Math.round(o.errMs ?? NaN) === Math.round(s.errMs ?? NaN))) return
  syncStatus = s
  syncListeners.forEach(l => l())
}
/** The running beat sync, null when none. */
export const useSyncStatus = () => useSyncExternalStore(l => { syncListeners.add(l); return () => syncListeners.delete(l) }, () => syncStatus)

class AudioEngine {
  private ctx: AudioContext | null = null
  private els: HTMLAudioElement[] = []
  private gains: GainNode[] = []
  private shelves: BiquadFilterNode[] = []
  private glide: { el: number; from: number; t0: number; dur: number } | null = null
  private master!: GainNode
  private volume!: GainNode
  analyser: AnalyserNode | null = null
  private delay: DelayNode | null = null
  private leadWant: number | null = null
  private act = 0
  private cur: string | null = null
  private fade: Fade | null = null
  private advanced: string | null = null
  /** Blend length for the next change of track, set by the event that causes it. */
  blend: number = BLEND.glide
  private queue: QueueState | null = null
  private resolve: (id: string) => TrackInfo | undefined = () => undefined
  /** Called when the track ends or is about to blend into the next one. */
  onAdvance: (sync: boolean) => void = () => {}
  /** Tells the server where the sound really is, after tempo changes moved it off the clock. */
  onResync: (position: number) => void = () => {}

  /** Follow `setVolume`, smoothed over ~30 ms so a drag does not crackle. */
  applyVolume() {
    if (this.ctx) this.volume.gain.setTargetAtTime(gainOf(), this.ctx.currentTime, 0.01)
  }

  /** Create the graph. Call it from the user's press: browsers start audio only then. */
  unlock() {
    if (!this.ctx) {
      const ctx = (this.ctx = new AudioContext())
      this.master = ctx.createGain()
      this.analyser = ctx.createAnalyser()
      this.analyser.fftSize = 4096
      this.analyser.smoothingTimeConstant = 0.55
      this.volume = ctx.createGain()
      this.volume.gain.value = gainOf()
      this.delay = ctx.createDelay(0.5)
      this.delay.delayTime.value = 0.08
      this.master.connect(this.analyser)
      this.analyser.connect(this.delay) // before the volume, so the visuals ignore it
      this.delay.connect(this.volume)
      this.volume.connect(ctx.destination)
      for (let i = 0; i < 2; i++) {
        const el = new Audio()
        el.preload = 'auto'
        el.preservesPitch = true
        const g = ctx.createGain()
        g.gain.value = i === 0 ? 1 : 0
        const shelf = ctx.createBiquadFilter()
        shelf.type = 'lowshelf'
        shelf.frequency.value = SHELF_HZ
        ctx.createMediaElementSource(el).connect(shelf)
        shelf.connect(g)
        g.connect(this.master)
        this.els.push(el)
        this.gains.push(g)
        this.shelves.push(shelf)
      }
      window.setInterval(() => this.tick(), 40)
    }
    void this.ctx.resume()
    if (this.queue) this.follow(this.queue, this.resolve)
  }

  /** Where the sound is in the track it is going to: the incoming element while a blend runs. */
  private get landed() {
    return this.els[this.fade ? this.fade.to : this.act].currentTime
  }

  /** The tempo factor the playing element runs at (1 unless a beat sync is gliding back). */
  get rate() {
    return this.els[this.act]?.playbackRate ?? 1
  }

  /** Report the sound's real position to the server. */
  resync() {
    if (isSoundTab() && this.queue?.playing) this.onResync(this.landed)
  }

  /** How long the sound waits behind the analyser, seconds: the visuals' lookahead. */
  get lead() {
    return this.delay?.delayTime.value ?? 0
  }

  /** How far the sound heard on this tab trails the queue clock, seconds. */
  get lag() {
    return isSoundTab() ? this.lead : 0
  }

  /** Moved only when the asked value changes: gliding the delay bends the pitch while it plays, so it jumps when nothing plays. */
  setLead(s: number) {
    const v = Math.max(0, Math.min(0.45, s))
    if (!this.delay || Math.abs(v - (this.leadWant ?? NaN)) < 0.001) return
    const t = this.ctx!.currentTime
    if (this.leadWant === null || this.els[this.act].paused) this.delay.delayTime.setValueAtTime(v, t)
    else this.delay.delayTime.setTargetAtTime(v, t, 0.05)
    this.leadWant = v
  }

  /** Seconds into the playing element. */
  get time() {
    return this.els[this.act]?.currentTime ?? 0
  }

  seek(seconds: number) {
    const el = this.els[this.act]
    if (el && isSoundTab()) el.currentTime = Math.max(0, seconds)
  }

  /** Bring the sound in line with the queue. Safe to call on every change. */
  follow(q: QueueState, resolve: (id: string) => TrackInfo | undefined) {
    this.queue = q
    this.resolve = resolve
    if (!this.ctx) return
    const item = q.items[q.current]
    if (!isSoundTab() || !item) {
      this.silence()
      return
    }
    const info = resolve(item.track_id)
    if (!info) return
    const want = positionNow(q, clockSkew(), Date.now(), info.duration || Infinity)
    // Pausing during a blend ends it at once: the incoming track takes over.
    if (this.fade && !q.playing) this.endFade()
    // A blend already heading for this item (the automatic one got ahead of the server) is left alone.
    if (this.fade?.itemId !== item.item_id && this.cur !== item.item_id) {
      if (this.cur !== null && q.playing && !this.els[this.act].paused) this.xfade(item, info, want, this.blend)
      else this.hardLoad(item, info, want)
    }
    this.blend = BLEND.glide
    if (this.fade) return
    const el = this.els[this.act]
    if (!this.glide && Math.abs(el.currentTime - want) > DRIFT) el.currentTime = want
    if (q.playing) {
      void this.ctx.resume()
      if (el.paused) el.play().catch(() => {})
    } else {
      el.pause()
    }
    this.preloadNext()
  }

  private silence() {
    if (this.fade) this.endFade()
    this.els.forEach(el => el.pause())
    if (!this.queue?.items[this.queue.current]) this.cur = null
  }

  private load(i: number, info: TrackInfo, offset: number) {
    const el = this.els[i]
    if (el.dataset.src !== info.url) {
      el.src = info.url
      el.dataset.src = info.url
    }
    el.currentTime = Math.max(0, offset)
    el.playbackRate = 1
  }

  private hardLoad(item: QueueItem, info: TrackInfo, offset: number) {
    if (this.fade) this.endFade()
    this.glide = null
    this.els.forEach(el => el.pause())
    this.load(this.act, info, offset)
    this.gains[this.act].gain.cancelScheduledValues(0)
    this.gains[this.act].gain.value = 1
    this.cur = item.item_id
    this.advanced = null
  }

  private xfade(item: QueueItem, info: TrackInfo, offset: number, length: number, plan?: Plan) {
    if (this.fade) this.endFade()
    this.glide = null
    const ctx = this.ctx!
    const from = this.act
    const to = 1 - from
    const now = ctx.currentTime
    const outgoing = this.queue?.items.find(i => i.item_id === this.cur)
    this.load(to, info, offset)
    const sync = plan?.mode === 'sync'
    if (sync) this.els[to].playbackRate = plan.rate
    void this.els[to].play().catch(() => {})
    const { out, inn } = blendCurves(this.gains[from].gain.value)
    for (const g of this.gains) g.gain.cancelScheduledValues(now)
    this.gains[from].gain.setValueCurveAtTime(out, now, length)
    this.gains[to].gain.setValueCurveAtTime(inn, now, length)
    // The two basses never add: the incoming one is held down until the midpoint, then swapped.
    for (const s of this.shelves) s.gain.cancelScheduledValues(now)
    if (sync && plan.swap) {
      const mid = now + length / 2
      this.shelves[to].gain.setValueAtTime(SHELF_DB, now)
      this.shelves[to].gain.setTargetAtTime(0, mid, 0.04)
      this.shelves[from].gain.setTargetAtTime(SHELF_DB, mid, 0.04)
    }
    this.fade = { from, to, itemId: item.item_id, end: now + length, plan: sync ? plan : undefined }
    setSync(sync && outgoing ? { pair: `${outgoing.track_id}>${item.track_id}`, from: plan.bpmA!, to: plan.bpmB!, errMs: null, locked: false } : null)
  }

  private endFade() {
    const f = this.fade
    if (!f) return
    for (const [i, v] of [[f.from, 0], [f.to, 1]] as const) {
      this.gains[i].gain.cancelScheduledValues(0)
      this.gains[i].gain.value = v
    }
    for (const s of this.shelves) {
      s.gain.cancelScheduledValues(0)
      s.gain.value = 0
    }
    this.els[f.from].pause()
    const p = f.plan
    if (p && Math.abs(p.rate - 1) > 5e-4) {
      this.glide = { el: f.to, from: this.els[f.to].playbackRate, t0: performance.now(), dur: GLIDE_BEATS * (60 / p.bpmB!) * 1000 }
    }
    setSync(null)
    this.act = f.to
    this.cur = f.itemId
    this.fade = null
    this.advanced = null
  }

  /** Load the next track into the idle element so its blend starts at once. */
  private preloadNext() {
    const q = this.queue
    if (!q || this.fade) return
    const next = q.items[q.current + 1]
    const info = next && this.resolve(next.track_id)
    const idle = this.els[1 - this.act]
    if (info && idle.dataset.src !== info.url) {
      idle.src = info.url
      idle.dataset.src = info.url
    }
  }

  private tick() {
    const q = this.queue
    const f = this.fade
    if (f && this.ctx!.currentTime >= f.end) {
      this.endFade()
      // The incoming track ran at another tempo: tell the server where it really is.
      if (f.plan && q?.items[q.current]?.item_id === this.cur) this.resync()
    } else if (f?.plan) {
      const ei = this.els[f.to]
      if (!ei.paused && ei.readyState >= 3) {
        const l = lockPhase(ei.currentTime, this.els[f.from].currentTime, f.plan)
        if (l.jump) ei.currentTime += l.jump
        else ei.playbackRate = l.rate
        if (syncStatus) setSync({ ...syncStatus, errMs: l.errMs, locked: l.locked })
      }
    }
    if (this.glide) {
      const g = this.glide
      const p = Math.min(1, (performance.now() - g.t0) / g.dur)
      this.els[g.el].playbackRate = g.from + (1 - g.from) * p * p * (3 - 2 * p)
      if (p >= 1) {
        this.glide = null
        if (q?.items[q.current]?.item_id === this.cur) this.resync()
      }
    }
    if (!q || !q.playing || this.fade || !isSoundTab()) return
    const item = q.items[q.current]
    const info = item && this.resolve(item.track_id)
    const el = this.els[this.act]
    if (!info || item.item_id !== this.cur || this.advanced === item.item_id) return
    const dur = info.duration || el.duration
    const next = q.items[q.current + 1] ?? (q.repeat ? q.items[0] : undefined)
    const nextInfo = next && this.resolve(next.track_id)
    if (next && nextInfo && next.item_id !== item.item_id) {
      // Without a known duration the plan has nothing to count from: a plain 4 s fade at the end.
      const p: Plan = info.duration ? planBetween(q, item, next, this.resolve) : { mode: 'fade', mixOut: dur - BLEND.auto, len: BLEND.auto, startOff: 0, rate: 1 }
      if ((p.mode === 'sync' || dur > 2 * BLEND.auto) && el.currentTime >= p.mixOut) {
        this.advanced = item.item_id
        this.xfade(next, nextInfo, p.startOff + (el.currentTime - p.mixOut) * p.rate, p.len, p)
        this.onAdvance(p.mode === 'sync')
        return
      }
    }
    if (el.ended) {
      this.advanced = item.item_id
      this.onAdvance(false)
    }
  }
}

export const engine = new AudioEngine()
