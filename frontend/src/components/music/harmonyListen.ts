import { moodOf } from '../../harmony'
import { transposition, TRANSPOSED_COLOR, type Reading } from './crates/proximity'

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

/** Semitones from a's key to b's when b is the same scale moved up or down (crates/proximity's transposition); null otherwise. */
export const stepOf = (a: Reading, b: Reading) => transposition({ id: 'a', harmony: { track: a } }, { id: 'b', harmony: { track: b } })
const stepWords = (d: number) => `${d > 0 ? 'up' : 'down'} ${Math.abs(d)} semitone${Math.abs(d) === 1 ? '' : 's'} · ${d > 0 ? 'Lift' : 'Drop'}`
const keyName = (r: Reading) => `${r.tonic} ${r.mode === 'Aeolian' ? 'min' : r.mode === 'Ionian' ? 'maj' : r.mode}`

/** A transposition in the join's panel (the Step): the outgoing key as a plain bar, the incoming one beside it, a level
 *  higher per semitone (lower for a drop), rising into place with a riser marked "+N"; then the words. Same box as the notes. */
function drawStep(x: CanvasRenderingContext2D, X: number, Y: number, s: number, a: Reading, b: Reading, d: number, t: number, color: string) {
  const w = 40 * s
  const h = 5.5 * s
  const lvl = Math.min(3 * s, 13 * s / Math.max(1, Math.abs(d)))
  const mid = Y + 10 * s
  const yA = mid - h / 2 + (d * lvl) / 2
  const sl = quint((t - SLIDE_AT) / SLIDE)
  const yB = yA - d * lvl * sl
  x.fillStyle = alpha(moodColor(a), 0.9)
  x.beginPath()
  x.roundRect(X, yA, w, h, h / 2)
  x.fill()
  const rx = X + w + 5 * s
  x.strokeStyle = alpha(color, 0.95)
  x.lineWidth = 1.4 * s
  x.lineJoin = 'round'
  x.beginPath()
  x.moveTo(X + w + 1.5 * s, yA + h / 2)
  x.lineTo(rx, yA + h / 2)
  x.lineTo(rx, yB + h / 2)
  x.lineTo(rx + 3.5 * s, yB + h / 2)
  x.stroke()
  x.fillStyle = alpha(moodColor(b), 0.9)
  x.beginPath()
  x.roundRect(rx + 5 * s, yB, w, h, h / 2)
  x.fill()
  if (sl > 0.3) {
    x.font = `700 ${7 * s}px ui-sans-serif,system-ui`
    x.textAlign = 'center'
    x.fillStyle = alpha(color, smooth((sl - 0.3) / 0.4))
    x.fillText(`${d > 0 ? '+' : '−'}${Math.abs(d)}`, rx, Math.min(yA, yB) - 3 * s)
    x.textAlign = 'left'
  }
  // The key names under each bar.
  x.font = `500 ${5.6 * s}px ui-sans-serif,system-ui`
  x.fillStyle = 'rgba(230,237,243,.6)'
  x.fillText(keyName(a), X, Math.max(yA, yB) + h + 6.5 * s)
  x.save()
  x.globalAlpha *= Math.min(1, sl * 2)
  x.fillText(keyName(b), rx + 5 * s, Math.max(yA, yB) + h + 6.5 * s)
  x.restore()
  if (t >= SHARED_AT) {
    // "Same scale" in the transposition's colour, over how far and which way.
    const e = smooth((t - SHARED_AT) / 0.3)
    const y = Y + 2 * 7 * s + 6 * s + 13 * s
    x.font = `600 ${10 * s}px ui-sans-serif,system-ui`
    x.fillStyle = alpha(color, e)
    x.fillText('Same scale', X - 2 * s, y)
    x.font = `400 ${9 * s}px ui-sans-serif,system-ui`
    x.fillStyle = `rgba(230,237,243,${(0.75 * e).toFixed(3)})`
    x.fillText(stepWords(d), X - 2 * s, y + 12 * s)
  }
}

/** The join's panel: the outgoing key's run (outlined) over the incoming one, which slides from on top of it
 *  to its own place; the shared notes then light between the rows. t: seconds into the landing (Infinity: shown at rest). */
export function drawJoin(
  x: CanvasRenderingContext2D, X: number, Y: number, s: number,
  a: Reading, b: Reading | undefined, ph: Phase | null, verdict: { label: string; color: string } | null, names: boolean, bg = true,
) {
  const cw = 9 * s
  const rh = 7 * s
  const gap = 6 * s
  const pad = 8 * s
  const t = ph ? ph.t : Infinity
  // The same scale moved up or down: the Step instead of the notes (no names row).
  const step = b && !(ph && ph.land <= 0) ? stepOf(a, b) : null
  if (step !== null) names = false
  if (bg) {
    x.fillStyle = 'rgba(7,11,16,.82)'
    x.beginPath()
    x.roundRect(X - pad, Y - pad - (names ? 8 * s : 0), 12 * cw + 2 * pad, 2 * rh + gap + 2 * pad + 14 * s + (names ? 8 * s : 0) + (step !== null ? 12 * s : 0), 8 * s)
    x.fill()
  }
  if (step !== null) {
    drawStep(x, X, Y, s, a, b!, step, t, verdict?.color ?? TRANSPOSED_COLOR)
    return
  }
  for (let i = 0; i < 12; i++) {
    x.fillStyle = WHITE(0.06)
    x.fillRect(X + i * cw + s, Y, cw - 2 * s, rh)
    x.fillRect(X + i * cw + s, Y + rh + gap, cw - 2 * s, rh)
  }
  const na = notesOf(a)
  // The order of fifths turned so the outgoing key's run sits at cells 2..8: it never wraps, and the incoming one
  // only does when it is far (5 or 6 steps).
  const run = FIFTHS.map(n => na.has(n))
  const start = Math.max(0, run.findIndex((v, i) => v && !run[(i + 11) % 12]))
  const pos = (n: number) => (FIFTHS.indexOf(n) - start + 2 + 24) % 12
  if (names) {
    x.font = `500 ${5.6 * s}px ui-sans-serif,system-ui`
    x.textAlign = 'center'
    x.fillStyle = 'rgba(230,237,243,.6)'
    for (const n of FIFTHS) x.fillText(NAMES[n], X + pos(n) * cw + cw / 2, Y - 2 * s)
    x.textAlign = 'left'
  }
  // A key's notes as bars: consecutive cells join, so a key reads as one run. Shifted bars wrap round the 12 cells.
  const bars = (set: Set<number>, y: number, color: string, filled: boolean, shift: number, op: number) => {
    const ps = [...set].map(pos).sort((m, n) => m - n)
    const out: [number, number][] = []
    for (const p of ps) {
      const last = out[out.length - 1]
      if (last && p === last[0] + last[1]) last[1]++
      else out.push([p, 1])
    }
    if (out.length > 1 && out[0][0] === 0 && out[out.length - 1][0] + out[out.length - 1][1] === 12) {
      const [p, n] = out.pop()!
      out[0] = [p, n + out[0][1]]
    }
    x.save()
    x.beginPath()
    x.rect(X, y - s, 12 * cw, rh + 2 * s)
    x.clip()
    for (const [p, n] of out) {
      for (const k of [-12, 0, 12]) {
        const bx = X + (p + shift + k) * cw
        if (bx > X + 12 * cw || bx + n * cw < X) continue
        if (filled) {
          x.fillStyle = alpha(color, 0.85 * op)
          x.beginPath()
          x.roundRect(bx + 0.5 * s, y, n * cw - s, rh, 2.5 * s)
          x.fill()
        } else {
          x.strokeStyle = alpha(color, 0.95 * op)
          x.lineWidth = 1.2 * s
          x.beginPath()
          x.roundRect(bx + 1 * s, y + 0.6 * s, n * cw - 2 * s, rh - 1.2 * s, 2.5 * s)
          x.stroke()
        }
      }
    }
    x.restore()
  }
  bars(na, Y, moodColor(a), false, 0, 1)
  const y2 = Y + rh + gap
  if (!b || (ph && ph.land <= 0)) {
    // Still listening: the notes heard so far as dots on the lower row.
    const heard = ph?.heard
    if (heard) {
      const max = Math.max(...heard, 1e-6)
      for (const n of FIFTHS) {
        const h = heard[n] / max
        x.fillStyle = WHITE(0.12 + 0.8 * h)
        x.beginPath()
        x.arc(X + pos(n) * cw + cw / 2, y2 + rh / 2, 1.2 * s + 1.8 * s * h, 0, 7)
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
  bars(back, y2, moodColor(b), true, steps * sl, ph ? ph.land : 1)
  const e = smooth((t - SHARED_AT) / 0.3)
  if (e > 0) {
    for (const n of na) {
      if (!nb.has(n)) continue
      x.fillStyle = WHITE(0.85 * e)
      x.fillRect(X + pos(n) * cw + cw / 2 - 0.5 * s, Y + rh, s, gap)
    }
  }
  if (verdict && t >= SHARED_AT) {
    x.font = `500 ${10 * s}px ui-sans-serif,system-ui`
    x.fillStyle = alpha(verdict.color, smooth((t - SHARED_AT) / 0.3))
    x.fillText(`${shared} shared · ${Math.abs(steps)} step${Math.abs(steps) === 1 ? '' : 's'} apart · ${verdict.label}`, X - 2 * s, y2 + rh + 13 * s)
  }
}

/** Slots a small pair spans: the outgoing run sits at slots 5..11, the incoming one up to 6 fifths either side. */
export const PAIR_SLOTS = 18
const PAIR_HOME = 5

/** A small pair (a row's reason, a chip): the outgoing key's run outlined over the incoming one, filled, in fifths order
 *  centred on the outgoing key so nothing wraps; t: seconds since its slide began (Infinity: at rest). */
export function drawPair(x: CanvasRenderingContext2D, X: number, Y: number, cw: number, rh: number, gap: number, a: Reading, b: Reading, t = Infinity) {
  const d = stepOf(a, b)
  if (d !== null) {
    // The same scale moved: the small Step (two 12 px bars, 1 px a semitone, the riser in the transposition's colour).
    const h = Math.max(2.5, rh * 0.8)
    const yA = Y + rh + gap / 2 - h / 2 + Math.max(-5, Math.min(5, d)) / 2
    const yB = yA - Math.max(-5, Math.min(5, d)) * quint((t - SLIDE_AT) / SLIDE)
    const x0 = X + PAIR_HOME * cw
    x.fillStyle = alpha(moodColor(a), 0.9)
    x.beginPath()
    x.roundRect(x0, yA, 12, h, h / 2)
    x.fill()
    x.strokeStyle = alpha(TRANSPOSED_COLOR, 0.95)
    x.lineWidth = 1
    x.beginPath()
    x.moveTo(x0 + 13, yA + h / 2)
    x.lineTo(x0 + 15.5, yA + h / 2)
    x.lineTo(x0 + 15.5, yB + h / 2)
    x.lineTo(x0 + 18, yB + h / 2)
    x.stroke()
    x.fillStyle = alpha(moodColor(b), 0.9)
    x.beginPath()
    x.roundRect(x0 + 19, yB, 12, h, h / 2)
    x.fill()
    return
  }
  const na = notesOf(a)
  const run = FIFTHS.map(n => na.has(n))
  const start = Math.max(0, run.findIndex((v, i) => v && !run[(i + 11) % 12]))
  const slot = (n: number) => (((FIFTHS.indexOf(n) - start) % 12) + 12) % 12 + PAIR_HOME
  const { steps } = distance(a, b)
  const nb = notesOf(b)
  const sl = quint((t - SLIDE_AT) / SLIDE)
  // Consecutive slots draw as one bar, so a key reads as one run.
  const bars = (slots: number[]) => {
    const out: [number, number][] = []
    for (const p of [...slots].sort((m, n) => m - n)) {
      const last = out[out.length - 1]
      if (last && p === last[0] + last[1]) last[1]++
      else out.push([p, 1])
    }
    return out
  }
  x.strokeStyle = alpha(moodColor(a), 0.95)
  x.lineWidth = 1
  for (const [p, n] of bars([...na].map(slot))) x.strokeRect(X + p * cw + 0.5, Y + 0.5, n * cw - 1, rh - 1)
  x.fillStyle = alpha(moodColor(b), 0.9)
  const back = [...nb].map(n => slot((n - 7 * steps + 120) % 12))
  for (const [p, n] of bars(back)) x.fillRect(X + (p + steps * sl) * cw, Y + rh + gap, n * cw, rh)
  const e = smooth((t - SHARED_AT) / 0.3)
  if (e <= 0) return
  x.fillStyle = WHITE(0.55 * e)
  for (const n of na) if (nb.has(n)) x.fillRect(X + slot(n) * cw + cw / 2 - 0.5, Y + rh, 1, gap)
}
