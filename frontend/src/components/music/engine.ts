import { clockSkew, positionNow, type QueueItem, type QueueState, type TrackInfo } from '../../musicQueue'

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
export const isSoundTab = () => localStorage.getItem(SOUND_KEY) === TAB_ID

// --- the engine --------------------------------------------------------------

interface Fade {
  from: number
  to: number
  itemId: string
  end: number
}

class AudioEngine {
  private ctx: AudioContext | null = null
  private els: HTMLAudioElement[] = []
  private gains: GainNode[] = []
  private master!: GainNode
  private volume!: GainNode
  analyser: AnalyserNode | null = null
  private act = 0
  private cur: string | null = null
  private fade: Fade | null = null
  private advanced: string | null = null
  /** Blend length for the next change of track, set by the event that causes it. */
  blend: number = BLEND.glide
  private queue: QueueState | null = null
  private resolve: (id: string) => TrackInfo | undefined = () => undefined
  /** Called when the track ends or is about to blend into the next one. */
  onAdvance: () => void = () => {}

  /** Create the graph. Call it from the user's press: browsers start audio only then. */
  unlock() {
    if (!this.ctx) {
      const ctx = (this.ctx = new AudioContext())
      this.master = ctx.createGain()
      this.analyser = ctx.createAnalyser()
      this.analyser.fftSize = 4096
      this.analyser.smoothingTimeConstant = 0.55
      this.volume = ctx.createGain()
      this.master.connect(this.analyser)
      this.analyser.connect(this.volume) // before the volume, so the visuals ignore it
      this.volume.connect(ctx.destination)
      for (let i = 0; i < 2; i++) {
        const el = new Audio()
        el.preload = 'auto'
        el.preservesPitch = true
        const g = ctx.createGain()
        g.gain.value = i === 0 ? 1 : 0
        ctx.createMediaElementSource(el).connect(g)
        g.connect(this.master)
        this.els.push(el)
        this.gains.push(g)
      }
      window.setInterval(() => this.tick(), 40)
    }
    void this.ctx.resume()
    if (this.queue) this.follow(this.queue, this.resolve)
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
    if (Math.abs(el.currentTime - want) > DRIFT) el.currentTime = want
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
  }

  private hardLoad(item: QueueItem, info: TrackInfo, offset: number) {
    if (this.fade) this.endFade()
    this.els.forEach(el => el.pause())
    this.load(this.act, info, offset)
    this.gains[this.act].gain.cancelScheduledValues(0)
    this.gains[this.act].gain.value = 1
    this.cur = item.item_id
    this.advanced = null
  }

  private xfade(item: QueueItem, info: TrackInfo, offset: number, length: number) {
    if (this.fade) this.endFade()
    const ctx = this.ctx!
    const from = this.act
    const to = 1 - from
    const now = ctx.currentTime
    this.load(to, info, offset)
    void this.els[to].play().catch(() => {})
    const { out, inn } = blendCurves(this.gains[from].gain.value)
    for (const g of this.gains) g.gain.cancelScheduledValues(now)
    this.gains[from].gain.setValueCurveAtTime(out, now, length)
    this.gains[to].gain.setValueCurveAtTime(inn, now, length)
    this.fade = { from, to, itemId: item.item_id, end: now + length }
  }

  private endFade() {
    const f = this.fade
    if (!f) return
    for (const [i, v] of [[f.from, 0], [f.to, 1]] as const) {
      this.gains[i].gain.cancelScheduledValues(0)
      this.gains[i].gain.value = v
    }
    this.els[f.from].pause()
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
    if (this.fade && this.ctx!.currentTime >= this.fade.end) this.endFade()
    if (!q || !q.playing || this.fade || !isSoundTab()) return
    const item = q.items[q.current]
    const info = item && this.resolve(item.track_id)
    const el = this.els[this.act]
    if (!info || item.item_id !== this.cur || this.advanced === item.item_id) return
    const dur = info.duration || el.duration
    const next = q.items[q.current + 1] ?? (q.repeat ? q.items[0] : undefined)
    const nextInfo = next && this.resolve(next.track_id)
    if (next && nextInfo && next.item_id !== item.item_id && dur > 2 * BLEND.auto && el.currentTime >= dur - BLEND.auto) {
      this.advanced = item.item_id
      this.xfade(next, nextInfo, 0, BLEND.auto)
      this.onAdvance()
    } else if (el.ended) {
      this.advanced = item.item_id
      this.onAdvance()
    }
  }
}

export const engine = new AudioEngine()
