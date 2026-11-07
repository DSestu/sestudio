import { moodOf } from '../../harmony'
import type { Reading } from './crates/proximity'

// The harmony step of a track's analysis, as seen while it happens: the notes heard so far
// (the server sends them by tenths of the track while it measures the key), then the key's
// notes. Notes are drawn in the order of fifths, where a key's 7 notes sit side by side, so
// two keys' overlap reads as two overlapping runs. The queue row and the timeline's join
// share the clock and the drawing.

export const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
/** C G D A E B F# C# G# D# A# F. */
export const FIFTHS = Array.from({ length: 12 }, (_, i) => (i * 7) % 12)

/** Seconds the heard notes take to show, tenth by tenth, at the slowest. */
const REVEAL = 2.5
/** The key landing: the run takes its mood colour. */
const LAND = 0.5
/** At the join, after the landing: the incoming run slides to its place, the shared notes light, the verdict. */
export const SLIDE_AT = 0.4
export const SLIDE = 0.9
export const SHARED_AT = SLIDE_AT + SLIDE
export const VERDICT_AT = SHARED_AT + 0.5
/** The join's panel folds into its diamond this long after the verdict. */
export const FOLD_AT = VERDICT_AT + 2
/** When it is all over. */
const END = FOLD_AT + 0.5

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
export const quint = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2)

/** Track id -> when its notes were first seen (ms, performance clock), and the notes by tenths. */
const heardAt = new Map<string, { at: number; steps: number[][] }>()
/** Track id -> when its key arrived after that. */
const landedAt = new Map<string, number>()
let version = 0
const listeners = new Set<() => void>()
const emit = () => { version++; listeners.forEach(l => l()) }
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const snapshot = () => version

/** Whether a track's harmony step is playing out (its row shows the strip instead of the meter). */
export const listening = (id: string) => heardAt.has(id)

/** The server sent the notes heard so far (by tenths) of a track it is analysing. */
export function heard(id: string, steps: number[][]) {
  if (heardAt.has(id) || steps.length === 0) return
  heardAt.set(id, { at: performance.now(), steps })
  emit()
}

/** Where a track's harmony step is: the notes heard so far (12, C first), how far the key landed (0..1),
 *  seconds since it began landing (negative before); null when it is not playing out. */
export interface Phase { heard: number[]; land: number; t: number }

export function phaseOf(id: string, reading: Reading | undefined, now = performance.now()): Phase | null {
  const h = heardAt.get(id)
  if (!h) return null
  if (reading && !landedAt.has(id)) landedAt.set(id, now)
  const g = Math.min(1, (now - h.at) / 1000 / REVEAL) * h.steps.length
  const i = Math.max(0, Math.min(h.steps.length - 1, Math.ceil(g) - 1))
  const k = smooth(g - i)
  const a = h.steps[Math.max(0, i - 1)]
  const b = h.steps[i]
  const notes = b.map((v, j) => (i === 0 ? v * k : a[j] + (v - a[j]) * k))
  const l = landedAt.get(id)
  // The key lands once the heard notes have shown.
  const t = l === undefined ? -1 : (now - Math.max(l, h.at + REVEAL * 1000)) / 1000
  if (t > END) {
    heardAt.delete(id)
    landedAt.delete(id)
    queueMicrotask(emit)
    return null
  }
  return { heard: notes, land: smooth(t / LAND), t }
}

/** "oklch(66% .15 340)" at alpha a. */
export const alpha = (c: string, a: number) => c.replace(/\)$/, ` / ${a.toFixed(3)})`)
const WHITE = (a: number) => `rgba(255,255,255,${a.toFixed(3)})`

export const notesOf = (r: Reading) => new Set(r.notes.map(n => NAMES.indexOf(n)))
export const moodColor = (r: Reading) => moodOf(r.mode)?.color ?? 'oklch(72% .16 230)'

/** How far, in fifths, b's notes sit from a's (-5..6, the shift that lines them up best), and how many they share. */
export function distance(a: Reading, b: Reading): { steps: number; shared: number } {
  const na = notesOf(a)
  const nb = notesOf(b)
  let best = 0
  let most = -1
  for (const d of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6]) {
    let n = 0
    for (const x of na) if (nb.has((x + 7 * d + 120) % 12)) n++
    if (n > most) { most = n; best = d }
  }
  let shared = 0
  for (const x of na) if (nb.has(x)) shared++
  return { steps: best, shared }
}

/** The heard notes, then the key's run with a bracket and a dot on the home note: the queue row's strip. 12 cells of 6 px. */
export function drawStrip(x: CanvasRenderingContext2D, X: number, Y: number, s: number, ph: Phase | null, r: Reading | undefined) {
  const cw = 6 * s
  const H = 16 * s
  const land = ph ? ph.land : 1
  const heard = ph?.heard
  const max = heard ? Math.max(...heard, 1e-6) : 1
  const ns = r ? notesOf(r) : null
  const col = r ? moodColor(r) : ''
  for (let i = 0; i < 12; i++) {
    const n = FIFTHS[i]
    const inKey = !!ns?.has(n)
    const h = heard ? Math.max(1.5 * s, (heard[n] / max) * H) : inKey ? H * 0.7 : 1.5 * s
    const base = heard ? 0.7 : 0.16
    x.fillStyle = inKey && land > 0 ? alpha(col, 0.7 + 0.3 * land) : WHITE(inKey ? base : base + (0.16 - base) * land)
    x.fillRect(X + i * cw + 0.5 * s, Y - h, cw - 2 * s, h)
  }
  if (!r || land <= 0) return
  const run = FIFTHS.map(n => ns!.has(n))
  const start = run.findIndex((v, i) => v && !run[(i + 11) % 12])
  if (start >= 0 && run.filter(Boolean).length === 7 && start + 7 <= 12) {
    x.strokeStyle = alpha(col, 0.9 * land)
    x.lineWidth = 1.2 * s
    x.beginPath()
    x.roundRect(X + start * cw - s, Y - H - 3 * s, 7 * cw + s, H + 5 * s, 3 * s)
    x.stroke()
  }
  const ti = FIFTHS.indexOf(NAMES.indexOf(r.tonic))
  x.fillStyle = alpha(col, land)
  x.beginPath()
  x.arc(X + ti * cw + cw / 2 - 0.5 * s, Y + 4 * s, 1.6 * s, 0, 7)
  x.fill()
}

export const PANEL_W = 12 * 9 + 16

/** The join's panel: the outgoing key's run (outlined) over the incoming one, which slides from on top of it
 *  to its own place; the shared notes then light between the rows. t: seconds into the landing (Infinity: shown at rest). */
export function drawJoin(
  x: CanvasRenderingContext2D, X: number, Y: number, s: number,
  a: Reading, b: Reading | undefined, ph: Phase | null, verdict: { label: string; color: string } | null, names: boolean,
) {
  const cw = 9 * s
  const rh = 7 * s
  const gap = 6 * s
  const pad = 8 * s
  const t = ph ? ph.t : Infinity
  x.fillStyle = 'rgba(7,11,16,.82)'
  x.beginPath()
  x.roundRect(X - pad, Y - pad - (names ? 8 * s : 0), 12 * cw + 2 * pad, 2 * rh + gap + 2 * pad + 14 * s + (names ? 8 * s : 0), 8 * s)
  x.fill()
  for (let i = 0; i < 12; i++) {
    x.fillStyle = WHITE(0.06)
    x.fillRect(X + i * cw + s, Y, cw - 2 * s, rh)
    x.fillRect(X + i * cw + s, Y + rh + gap, cw - 2 * s, rh)
  }
  if (names) {
    x.font = `500 ${6.5 * s}px ui-sans-serif,system-ui`
    x.textAlign = 'center'
    x.fillStyle = 'rgba(230,237,243,.6)'
    for (let i = 0; i < 12; i++) x.fillText(NAMES[FIFTHS[i]], X + i * cw + cw / 2, Y - 2 * s)
    x.textAlign = 'left'
  }
  const na = notesOf(a)
  const cells = (set: Set<number>, y: number, color: string, filled: boolean, shift: number, op: number) => {
    for (let i = 0; i < 12; i++) {
      if (!set.has(FIFTHS[i])) continue
      const p = (((i + shift) % 12) + 12) % 12
      const cx = X + p * cw
      if (filled) {
        x.fillStyle = alpha(color, 0.85 * op)
        x.fillRect(cx + 0.5 * s, y, cw - s, rh)
      } else {
        x.strokeStyle = alpha(color, 0.95 * op)
        x.lineWidth = 1.2 * s
        x.strokeRect(cx + 1 * s, y + 0.6 * s, cw - 2 * s, rh - 1.2 * s)
      }
    }
  }
  cells(na, Y, moodColor(a), false, 0, 1)
  const y2 = Y + rh + gap
  if (!b || (ph && ph.land <= 0)) {
    // Still listening: the notes heard so far as dots on the lower row.
    const heard = ph?.heard
    if (heard) {
      const max = Math.max(...heard, 1e-6)
      for (let i = 0; i < 12; i++) {
        const h = heard[FIFTHS[i]] / max
        x.fillStyle = WHITE(0.12 + 0.8 * h)
        x.beginPath()
        x.arc(X + i * cw + cw / 2, y2 + rh / 2, 1.2 * s + 1.8 * s * h, 0, 7)
        x.fill()
      }
    }
    return
  }
  const { steps, shared } = distance(a, b)
  const nb = notesOf(b)
  // b's notes drawn shifted back onto a's place, then sliding forward by `steps`.
  const sl = quint((t - SLIDE_AT) / SLIDE)
  const back = new Set([...nb].map(n => (n - 7 * steps + 120) % 12))
  cells(back, y2, moodColor(b), true, steps * sl, ph ? ph.land : 1)
  const e = smooth((t - SHARED_AT) / 0.3)
  if (e > 0) {
    for (let i = 0; i < 12; i++) {
      if (!na.has(FIFTHS[i]) || !nb.has(FIFTHS[i])) continue
      x.fillStyle = WHITE(0.85 * e)
      x.fillRect(X + i * cw + cw / 2 - 0.5 * s, Y + rh, s, gap)
    }
  }
  if (verdict && t >= SHARED_AT) {
    x.font = `500 ${10 * s}px ui-sans-serif,system-ui`
    x.fillStyle = alpha(verdict.color, smooth((t - SHARED_AT) / 0.3))
    x.fillText(`${shared} shared · ${Math.abs(steps)} step${Math.abs(steps) === 1 ? '' : 's'} apart · ${verdict.label}`, X - 2 * s, y2 + rh + 13 * s)
  }
}
