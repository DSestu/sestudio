// Flow → mix generator (docs/SPEC-music-flows.md §6), shared by index.html and `node flowgen.js` (self-check).
// Same rules as flowgen.py; this one is what the interactive page runs.

export const BLEND_S = 20 // shortcut: fixed overlap, the real plan() varies per pair
export const TEMPO_BAND = 3
export const ENERGY_BAND = 0.2 // one step of five on the library's percentile scale
export const SAFE_NOTES = 6 // of 7, the app's "safe join" (proximity.py)
export const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
// Steps from the tonic, brightest to darkest, then the two harmonic-minor modes (modes.py).
export const SCALES = {
  Lydian: [0, 2, 4, 6, 7, 9, 11], Ionian: [0, 2, 4, 5, 7, 9, 11], Mixolydian: [0, 2, 4, 5, 7, 9, 10],
  Dorian: [0, 2, 3, 5, 7, 9, 10], Aeolian: [0, 2, 3, 5, 7, 8, 10], Phrygian: [0, 1, 3, 5, 7, 8, 10],
  Locrian: [0, 1, 3, 5, 6, 8, 10], 'Harmonic minor': [0, 2, 3, 5, 7, 8, 11], 'Phrygian dominant': [0, 1, 4, 5, 7, 8, 10],
}
// Relaxation order (spec §6.4), cumulative; `any` turns the curves into preferences.
export const LADDER = ['tempo', 'energy', 'genre', 'any'] // harmony is never relaxed: it is a pull, not a gate
export const PULL = { light: 1, strong: 2, only: 6 } // how much the harmony fit weighs against tempo and energy (1 each)

/** How well join kind k serves what the flow wants at this join (an event kind, or 'match'): 0..1. */
export function harmonyFit(k, want = 'match') {
  if (!k) return 0.4 // unread key: neither a reason nor an objection
  if (k === want) return 1
  if (k === 'break') return 0
  if (want === 'match') return k === 'relative' ? 0.8 : 0.6 // a safe modulation nobody asked for
  if (want === 'break') return 0.2
  return k === 'match' ? 0.5 : 0.6 // an event is pending: a plain match waits, another modulation half serves
}

export function load(lib) {
  lib = lib.filter(t => t.bpm && t.energy != null)
  const scale = lib.map(t => t.energy).sort((a, b) => a - b)
  for (const t of lib) {
    t.e = scale.indexOf(t.energy) / Math.max(1, scale.length - 1)
    const h = t.harmony?.track
    t.scale = h && h.tonic in Object.fromEntries(NAMES.map(n => [n, 1])) ? { tonic: NAMES.indexOf(h.tonic), mode: h.mode, unsure: !!h.unsure } : null
  }
  return lib
}

/** Pitch classes of a scale {tonic (0..11), mode}. */
export const notes = s => new Set(SCALES[s.mode].map(d => (s.tonic + d) % 12))
export const shared = (a, b) => [...notes(a)].filter(n => notes(b).has(n)).length
export const scaleName = s => `${NAMES[s.tonic]} ${s.mode}`
// What a join a -> b is (spec §4.2). Modulations are a one-note swap between 7-note sets: sharpward = brighter.
export const KINDS = {
  match: 'Match', relative: 'Relative', up: 'Up a fifth', down: 'Down a fifth',
  'mode+': 'Brighter mode', 'mode-': 'Darker mode', shift: 'Shift', break: 'Break',
}
export const MODULATIONS = ['up', 'down', 'mode+', 'mode-', 'relative', 'break']
export function join(a, b) {
  if (!a?.scale || !b?.scale) return null
  const n = shared(a.scale, b.scale)
  if (n === 7) return a.scale.tonic === b.scale.tonic ? 'match' : 'relative'
  if (n < SAFE_NOTES) return 'break'
  const A = notes(a.scale), B = notes(b.scale)
  const dropped = [...A].find(x => !B.has(x)), added = [...B].find(x => !A.has(x))
  const dir = (added - dropped + 12) % 12 === 1 ? '+' : (dropped - added + 12) % 12 === 1 ? '-' : null
  if (!dir) return 'shift' // the harmonic-minor scales: safe, but not a step round the circle of fifths
  if (a.scale.tonic === b.scale.tonic) return 'mode' + dir
  return dir === '+' ? 'up' : 'down'
}

export function curve(points, f) {
  if (f <= points[0][0]) return points[0][1]
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i]
    if (f <= x1) return y0 + ((y1 - y0) * (f - x0)) / (x1 - x0 || 1)
  }
  return points.at(-1)[1]
}

export const block = (blocks, f) => (blocks || []).find(b => b.from <= f && f < b.to) || null

/** [score, harmony label] when t passes every must, else null. ctx: {event, harmony} from render(). */
export function score(t, prev, L, f, relax, ctx = {}) {
  let s = 0
  const any = relax.has('any')
  if (L.tempo) {
    const band = TEMPO_BAND * (relax.has('tempo') ? 8 / 3 : 1)
    const d = Math.abs(t.bpm - curve(L.tempo, f))
    if (d > band && !any) return null
    s += 1 - d / band
  }
  if (L.energy) {
    const band = ENERGY_BAND * (relax.has('energy') ? 2 : 1)
    const d = Math.abs(t.e - curve(L.energy, f))
    if (d > band && !any) return null
    s += 1 - d / band
  }
  let label = t.scale ? scaleName(t.scale) + (t.scale.unsure ? '?' : '') : '?'
  if (prev && ctx.harmony) {
    const k = join(prev, t)
    label = k ? KINDS[k] : '?'
    s += (ctx.pull ?? PULL.strong) * harmonyFit(k, ctx.event || 'match')
  }
  const g = block(L.genre, f)
  if (g && g.genres?.length && !relax.has('genre')) {
    if (g.genres.includes(t.genre)) s += 1
    else if ((g.strict || 'must') === 'must') return null
  }
  return [s, label]
}

function rng(seed) { // mulberry32
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Chunk list along a path. choices: {forkChunkId: nextId}; an unchosen fork is the generator's pick. */
export function resolve(flow, choices, lib, opts) {
  const by = Object.fromEntries(flow.chunks.map(c => [c.id, c]))
  const out = []
  const auto = {}
  let c = flow.chunks[0]
  while (c && !out.includes(c)) {
    out.push(c)
    const nxt = c.next || []
    if (!nxt.length) break
    if (choices[c.id] && nxt.includes(choices[c.id])) c = by[choices[c.id]]
    else if (nxt.length === 1) c = by[nxt[0]]
    else {
      const cost = id => {
        const trial = out.concat([by[id]], firstPath(by, by[id]))
        const mix = render(trial, lib, { ...opts, pins: {} })
        return mix.reduce((a, m) => a + m.relaxed.filter(r => r !== 'pin').length * 10 - m.score, 0)
      }
      const best = nxt.reduce((a, b) => (cost(b) < cost(a) ? b : a))
      auto[c.id] = best
      c = by[best]
    }
  }
  return { chunks: out, auto }
}

function firstPath(by, c) {
  const out = []
  while (c.next?.length && !out.includes(by[c.next[0]])) out.push((c = by[c.next[0]]))
  return out
}

/** Chunk spans as fractions of the whole path. */
export function spans(chunks) {
  const total = chunks.reduce((a, c) => a + c.share, 0)
  let acc = 0
  return chunks.map(c => {
    const s = { a: acc / total, b: (acc + c.share) / total, c }
    acc += c.share
    return s
  })
}

/** opts: {minutes, seed, pins: {slot: trackId}, pull: PULL value} */
export function render(chunks, lib, { minutes, seed, pins = {}, pull = PULL.strong }) {
  const sp = spans(chunks)
  const rand = rng(seed)
  const byId = Object.fromEntries(lib.map(x => [x.id, x]))
  const used = new Set(Object.values(pins))
  const mix = []
  const done = new Set() // realised events, as chunk id + index
  let t = 0, prev = null, i = 0
  while (t < minutes * 60) {
    const f = t / (minutes * 60)
    const s = sp.find(x => x.a <= f && f < x.b) || sp.at(-1)
    const L = s.c.layers
    const local = (f - s.a) / (s.b - s.a || 1)
    // the first unrealised event at or before this point; a missed one slides to the next join
    const evI = (L.harmony || []).findIndex((e, k) => e.at <= local && !done.has(s.c.id + ':' + k))
    const ev = evI < 0 ? null : L.harmony[evI]
    const ctx = { event: ev?.kind || null, harmony: !!L.harmony, pull }
    let pick, got, relaxed
    if (pins[i] && byId[pins[i]]) {
      pick = byId[pins[i]]
      relaxed = ['pin']
      got = score(pick, prev, L, local, new Set(LADDER), ctx) || [0, pick.scale ? scaleName(pick.scale) : '?']
    } else {
      relaxed = []
      let pool = []
      const have = new Set([...Object.keys(L).filter(k => L[k]), 'any'])
      const steps = LADDER.filter(x => have.has(x.split(':')[0]))
      // One layer alone first (near implies loose, far implies both), then the cumulative ladder: the label names what mattered.
      const singles = steps.filter(s => s !== 'any').map(s => steps.filter(x => x.split(':')[0] === s.split(':')[0] && steps.indexOf(x) <= steps.indexOf(s)))
      const prefixes = steps.map((_, i) => steps.slice(0, i + 1))
      for (const set of [[], ...singles, ...prefixes]) {
        relaxed = set
        const r = new Set(relaxed)
        pool = lib.filter(x => !used.has(x.id)).map(x => [x, score(x, prev, L, local, r, ctx)]).filter(p => p[1])
        if (pool.length) break
      }
      if (!pool.length) break // library exhausted
      pool.sort((p, q) => q[1][0] - p[1][0])
      // the seed only decides between near-ties, so a cousin mix never takes a clearly worse join
      const top = pool.filter(p => p[1][0] >= pool[0][1][0] - 0.15)
      ;[pick, got] = top[Math.floor(rand() * top.length)]
      used.add(pick.id)
    }
    const k = prev ? join(prev, pick) : null
    const realised = ev && k === ev.kind
    if (realised) done.add(s.c.id + ':' + evI)
    mix.push({
      at: t, chunk: s.c.id, track: pick, score: got[0], move: got[1], relaxed, local, join: k, fit: prev && L.harmony ? harmonyFit(k, ev?.kind || 'match') : null,
      event: ev ? { ...ev, index: evI, realised } : null,
      tempoT: L.tempo ? curve(L.tempo, local) : null, energyT: L.energy ? curve(L.energy, local) : null,
    })
    t += Math.max(60, (pick.dur || 240) - BLEND_S)
    prev = pick
    i++
  }
  return mix
}

// ---------- self-check: node flowgen.js ----------
if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  const assert = (c, m) => { if (!c) throw new Error(m) }
  const T = (i, bpm, tonic, mode, e, g = 'DnB') => ({ id: String(i), title: `t${i}`, dur: 300, bpm, genre: g, energy: e, harmony: tonic ? { track: { tonic, mode } } : null })
  const J = (a, b) => join(load([T(1, 1, ...a, 1)])[0], load([T(2, 1, ...b, 1)])[0])
  assert(J(['F', 'Aeolian'], ['F', 'Aeolian']) === 'match', 'match')
  assert(J(['F', 'Aeolian'], ['G#', 'Ionian']) === 'relative', 'relative major')
  assert(J(['F', 'Aeolian'], ['C', 'Aeolian']) === 'up', 'up a fifth')
  assert(J(['F', 'Aeolian'], ['A#', 'Aeolian']) === 'down', 'down a fifth')
  assert(J(['F', 'Aeolian'], ['F', 'Dorian']) === 'mode+', 'brighter mode')
  assert(J(['F', 'Aeolian'], ['F', 'Phrygian']) === 'mode-', 'darker mode')
  assert(J(['F', 'Aeolian'], ['D#', 'Ionian']) === 'up', 'relative of the dominant reads as up')
  assert(J(['F', 'Aeolian'], ['B', 'Ionian']) === 'break', 'break')
  assert(J(['F', 'Aeolian'], ['F', 'Harmonic minor']) === 'mode+', 'raised seventh reads as a brighter mode')
  const lib = load(Array.from({ length: 30 }, (_, i) => T(i, 170 + (i % 6), NAMES[i % 12], 'Aeolian', i)))
  const ev = [{ id: 'c', share: 1, layers: { harmony: [{ at: 0.4, kind: 'up' }, { at: 0.7, kind: 'break' }] } }]
  const me = render(ev, lib, { minutes: 30, seed: 1 })
  const kinds = me.map(m => m.join)
  assert(kinds[1] === 'match' && kinds.includes('up') && kinds.includes('break'), 'match by default, events realised: ' + kinds)
  assert(me.filter(m => m.event?.realised).length === 2, 'both events realised once')
  assert(me.every(m => !m.relaxed.length), 'no relaxation needed: ' + me.map(m => m.relaxed))
  assert(harmonyFit('match') === 1 && harmonyFit('relative') === 0.8 && harmonyFit('up') === 0.6 && harmonyFit('break') === 0, 'fit for a match')
  assert(harmonyFit('up', 'up') === 1 && harmonyFit('match', 'up') === 0.5 && harmonyFit('break', 'break') === 1, 'fit for an event')
  // a pull, not a gate: with a tempo band the only in-band track wins even when it breaks the key
  const narrow = load([T(1, 172, 'F', 'Aeolian', 1), T(2, 172, 'B', 'Ionian', 2), T(3, 150, 'F', 'Aeolian', 3)])
  const mp = render([{ id: 'p', share: 1, layers: { tempo: [[0, 172], [1, 172]], harmony: [] } }], narrow, { minutes: 9, seed: 1, pins: { 0: '1' } })
  assert(mp[1].track.id === '2' && mp[1].join === 'break' && !mp[1].relaxed.length, 'in-band break beats out-of-band match: ' + mp.map(m => m.track.id + ':' + m.join))
  assert(render([{ id: 'p', share: 1, layers: { harmony: [] } }], narrow, { minutes: 9, seed: 1, pins: { 0: '1' } })[1].track.id === '3', 'without a band the match wins')
  const flow = [{ id: 'x', share: 1, layers: { tempo: [[0, 172], [1, 172]], genre: [{ from: 0, to: 1, genres: ['DnB'] }] } }]
  const ids = m => m.map(x => x.track.id).join()
  const m1 = render(flow, lib, { minutes: 30, seed: 7 })
  assert(ids(m1) === ids(render(flow, lib, { minutes: 30, seed: 7 })), 'seeded')
  assert(new Set(m1.map(x => x.track.id)).size === m1.length, 'no repeats')
  assert(render(flow, lib, { minutes: 30, seed: 7, pins: { 2: '29' } })[2].track.id === '29', 'pin kept')
  const far = [{ id: 'y', share: 1, layers: { tempo: [[0, 124], [1, 124]] } }]
  const mf = render(far, lib, { minutes: 10, seed: 1 })
  assert(mf.length >= 2 && mf.every(x => x.relaxed.length), 'relaxes but fills')
  const fork = { chunks: [{ id: 'a', share: 1, next: ['b', 'c'], layers: {} }, { id: 'b', share: 1, layers: { tempo: [[0, 124], [1, 124]] } }, { id: 'c', share: 1, layers: { tempo: [[0, 172], [1, 172]] } }] }
  assert(resolve(fork, {}, lib, { minutes: 30, seed: 1 }).auto.a === 'c', 'generator takes the fillable future')
  assert(resolve(fork, { a: 'b' }, lib, { minutes: 30, seed: 1 }).chunks[1].id === 'b', 'listener choice wins')
  console.log('selftest ok')
}
