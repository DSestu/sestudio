// Ordering a set into its best succession (Blend), shared by the L/M/N mockups.
// shortcut: a greedy pass with a shape target, not the real blend.py; fine for mockups.

/** How far apart two neighbours sound, 0 (seamless) .. 1 (a wall). */
/** Blend weights: how much each axis counts (importance 0..1, normalised when used). */
const AXES = { harmony: ['Harmony', 'oklch(80% .14 85)'], mood: ['Mood', 'oklch(70% .15 340)'], energy: ['Energy', 'oklch(72% .16 230)'], genre: ['Genre', 'oklch(75% .12 180)'] }
const BW_DEF = { harmony: .9, mood: .45, energy: .7, genre: .35 }
/** Harmony moves between two keys (the app's join kinds) and how welcome each is, 0..1. */
const MOVES = {
  same: ['Same key', 'Same tonic and mode'], relative: ['Relative', 'Same notes, other tonic (A minor ↔ C major)'],
  next: ['Next door', 'A fifth away, 6 shared notes'], mode: ['Mode change', 'Same tonic, brighter or darker mode'],
  lift: ['Lift', 'Same mode, 1 to 6 semitones up'], drop: ['Drop', 'Same mode, 1 to 6 semitones down'],
  clash: ['Clash', '5 shared notes or fewer'],
}
const HW_DEF = { same: 1, relative: .9, next: .85, mode: .55, lift: .45, drop: .35, clash: 0 }
const loadJ = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') } } catch { return { ...d } } }
window.BW = loadJ('sestudio-blendw', BW_DEF); window.HW = loadJ('sestudio-harmw', HW_DEF)
const blendShares = () => { const s = Object.values(BW).reduce((x, y) => x + y, 0) || 1; return Object.fromEntries(Object.entries(BW).map(([k, v]) => [k, v / s])) }

const HCACHE = new Map()
const harm = t => { if (typeof harmonyOf !== 'function') return null; if (!HCACHE.has(t.id)) HCACHE.set(t.id, harmonyOf(t)); return HCACHE.get(t.id) }
const notesOf = t => harm(t)?.notes || null
function sharedNotes(a, b) { const x = notesOf(a), y = notesOf(b); return x && y ? x.filter(n => y.includes(n)).length : null }
const PC12 = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
/** The move from a's key to b's: { kind, label, shared, d }. */
function harmKind(a, b) {
  const x = harm(a), y = harm(b); if (!x || !y) return null
  const shared = x.notes.filter(n => y.notes.includes(n)).length
  let d = (PC12.indexOf(y.tonic) - PC12.indexOf(x.tonic) + 12) % 12; if (d > 6) d -= 12
  let kind
  if (d === 0 && x.mode === y.mode) kind = 'same'
  else if (shared === 7) kind = 'relative'
  else if (d === 0) kind = 'mode'
  else if (shared === 6) kind = 'next'
  else if (x.mode === y.mode) kind = d > 0 ? 'lift' : 'drop'
  else kind = 'clash'
  const label = kind === 'lift' ? `Up ${d}` : kind === 'drop' ? `Down ${-d}` : kind === 'clash' ? `${shared} shared notes` : MOVES[kind][0]
  return { kind, label, shared, d }
}
/** 0 for the most welcome move, 1 for the least. */
const harmD = (a, b) => { const k = harmKind(a, b); return k ? 1 - (HW[k.kind] ?? 0) : .3 }
const genreD = (a, b) => a.g && b.g ? (a.g === b.g ? 0 : 1) : .4
const joinD = (a, b) => {
  if (!a.bpm || !b.bpm) return .3
  const w = blendShares()
  const axes = harmD(a, b) * w.harmony + Math.abs(a.m.b - b.m.b) / 4 * w.mood + Math.min(1, Math.abs((a.eo ?? a.e ?? 0) - (b.ei ?? b.e ?? 0)) / 50) * w.energy + genreD(a, b) * w.genre
  return Math.min(1, tdist(b.bpm, a.bpm) / 30 * tv('jTempo', .3) + axes * .9)
}
const GOOD = 'oklch(76% .17 155)', OK = 'oklch(83% .16 85)', ROUGH = 'oklch(68% .19 25)'
const markOf = d => d < tv("goodBelow", .22) ? GOOD : d < tv("roughFrom", .42) ? OK : ROUGH
const SHAPES = { Hold: i => .5, Lift: i => .25 + i * .65, Ease: i => .85 - i * .6, Arc: i => .3 + Math.sin(i * Math.PI) * .6 }

/** Greedy best succession: nearest next track, leaning towards the shape's energy. */
function bestOrder(ts, { shape = 'Arc', first } = {}) {
  const left = [...ts], out = []
  const eLo = Math.min(...ts.map(t => t.e || 0)), eHi = Math.max(...ts.map(t => t.e || 0)) || 1
  let cur = first || left.sort((a, b) => (a.e || 0) - (b.e || 0))[0]
  left.splice(left.indexOf(cur), 1); out.push(cur)
  while (left.length) {
    const want = eLo + SHAPES[shape](out.length / (ts.length - 1)) * (eHi - eLo)
    let best = left[0], bc = 9
    for (const t of left) { const c = joinD(cur, t) + Math.abs((t.e || 0) - want) / 60 * tv("shapePull", .8); if (c < bc) { bc = c; best = t } }
    left.splice(left.indexOf(best), 1); out.push(best); cur = best
  }
  return out
}
function scoreOf(ts) {
  const ds = ts.slice(1).map((t, i) => joinD(ts[i], t))
  return { smooth: Math.round((1 - avg(ds)) * 100), rough: ds.filter(d => d >= tv("roughFrom", .42)).length, ok: ds.filter(d => d >= tv("goodBelow", .22) && d < tv("roughFrom", .42)).length, n: ds.length }
}

/** A strip of tracks end to end with a Blend diamond on every join. */
function joinStrip(ts, w, h, { gap = 6, diamonds = true, hiFrom = -1, alpha = .9, energyLine = false } = {}) {
  const total = ts.reduce((a, t) => a + t.d, 0), usable = w - gap * (ts.length - 1)
  let x = 0, o = '', marks = '', pts = []
  ts.forEach((t, i) => {
    const tw = Math.max(2, usable * t.d / total)
    o += `<path d="${silhouette(t.curve, x, tw, h - 12, (h - 12) / 2 + 6)}" fill="${trackColor(t)}" fill-opacity="${i < hiFrom ? .25 : alpha}"/>`
    pts.push([x + tw / 2, 6 + (1 - (t.e || 0) / 100) * (h - 12)])
    if (diamonds && i < ts.length - 1) { const d = joinD(t, ts[i + 1]), cx = x + tw + gap / 2, s = Math.min(5, gap / 2 + 1.5); marks += `<path d="M${cx},${h / 2 - s}L${cx + s},${h / 2}L${cx},${h / 2 + s}L${cx - s},${h / 2}Z" fill="${markOf(d)}" stroke="var(--bg)" stroke-width="1"/>` }
    x += tw + gap
  })
  const line = energyLine ? `<path d="M${pts.map(p => p.map(v => v.toFixed(1)).join(',')).join('L')}" fill="none" stroke="oklch(95% .01 240 / .7)" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` : ''
  return `<svg class="ribbon" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" style="display:block">${o}${line}${marks}</svg>`
}
const scoreChips = s => `<span class="chip"><i class="dot" style="background:${GOOD}"></i>${s.n - s.rough - s.ok} smooth</span><span class="chip"><i class="dot" style="background:${OK}"></i>${s.ok} close</span><span class="chip"><i class="dot" style="background:${ROUGH}"></i>${s.rough} rough</span>`
// The sets used across the mockups.
const SEARCH = T.filter(t => (t.m.word === 'Dark' || t.m.word === 'Menacing') && t.e >= 55 && t.bpm >= 124 && t.bpm <= 132).filter((t, i, a) => a.findIndex(u => u.t === t.t) === i)
const QUEUE = PLAYLISTS[0].tracks.slice(0, 18)

/** Harmony walk: each next track shares as many notes as possible with the last (a walk round the
 *  circle of fifths), ties broken by the rest of the blend; then swaps that cut clashes. */
function harmonyOrder(ts, { first } = {}) {
  if (ts.length < 3) return ts.slice()
  const left = [...ts], out = []
  let cur = first || left.slice().sort((a, b) => (a.e || 0) - (b.e || 0))[0]
  left.splice(left.indexOf(cur), 1); out.push(cur)
  while (left.length) {
    let best = left[0], bc = Infinity
    for (const t of left) { const s = sharedNotes(cur, t), c = (s == null ? 2.5 : 7 - s) + joinD(cur, t) * .9; if (c < bc) { bc = c; best = t } }
    left.splice(left.indexOf(best), 1); out.push(best); cur = best
  }
  const cost = (a, b) => { const s = sharedNotes(a, b); return (s == null ? 2.5 : 7 - s) + (s != null && s <= 5 ? 3 : 0) + joinD(a, b) * .9 }
  const n = out.length
  for (let pass = 0, better = true; better && pass < 6 && n <= 200; pass++) {
    better = false
    for (let i = 1; i < n - 1; i++) for (let j = i + 1; j < n; j++) {
      const before = cost(out[i - 1], out[i]) + (j < n - 1 ? cost(out[j], out[j + 1]) : 0)
      const after = cost(out[i - 1], out[j]) + (j < n - 1 ? cost(out[i], out[j + 1]) : 0)
      if (after < before - .01) { out.splice(i, j - i + 1, ...out.slice(i, j + 1).reverse()); better = true }
    }
  }
  return out
}
/** Joins sharing 5 notes or fewer: the app's clash rule. */
const clashCount = o => o.slice(1).filter((t, i) => harmKind(o[i], t)?.kind === 'clash').length
