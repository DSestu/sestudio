// Shared data shaping, generated identity and app chrome for the library mockups.
// Data is the live library (data.js), captured 2026-11-08.

const MOODS = {
  Lydian: ['Floating', 'oklch(88% .12 95)', 3],
  Ionian: ['Bright', 'oklch(83% .13 75)', 2],
  Mixolydian: ['Warm', 'oklch(77% .13 45)', 1],
  Dorian: ['Smooth', 'oklch(72% .13 10)', 0],
  Aeolian: ['Dark', 'oklch(66% .15 340)', -1],
  Phrygian: ['Menacing', 'oklch(62% .17 310)', -2],
  Locrian: ['Unstable', 'oklch(56% .18 290)', -3],
}
const LADDER = Object.entries(MOODS).map(([mode, [word, color, b]]) => ({ mode, word, color, b }))
const EXOTIC = { word: 'Exotic', color: 'oklch(70% .14 200)', b: 0 }
const NONE = { word: 'Unread', color: 'oklch(45% .02 240)', b: 0 }
const mood = t => (t.mode && MOODS[t.mode] ? { word: MOODS[t.mode][0], color: MOODS[t.mode][1], b: MOODS[t.mode][2] } : t.mode ? EXOTIC : NONE)

const canon = s => (s || '').trim()
const T = TRACKS.map(t => ({ ...t, bpm: t.bpm && Math.round(t.bpm), bands: t.bands ?? (window.BANDS || {})[t.id] ?? null })).map(t => {
  const ar = canon(t.ar) || 'Various artists'
  const fl = (window.FILES || {})[t.id] || []
  return { ...t, ar: /^deadmau5$/i.test(ar) ? 'Deadmau5' : ar, al: canon(t.al) || t.lib, m: mood(t), f: fl[0] || '', fn: fl[1] || t.t }
}).sort((a, b) => a.al.localeCompare(b.al) || a.t.localeCompare(b.t))

function groupBy(list, key) {
  const m = new Map()
  for (const t of list) { const k = key(t); if (!m.has(k)) m.set(k, []); m.get(k).push(t) }
  return m
}
const most = arr => { const c = {}; arr.forEach(v => c[v] = (c[v] || 0) + 1); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] }
const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0

function summarise(name, tracks, kind, extra = {}) {
  const bpms = tracks.map(t => t.bpm).filter(Boolean)
  const moods = tracks.map(t => t.m.word)
  const word = most(moods)
  return {
    name, kind, tracks, n: tracks.length,
    artist: extra.artist ?? (new Set(tracks.map(t => t.ar)).size > 1 ? 'Various artists' : tracks[0].ar),
    bpmLo: Math.min(...bpms), bpmHi: Math.max(...bpms), bpm: Math.round(avg(bpms)),
    energy: Math.round(avg(tracks.map(t => t.e || 0))),
    dur: tracks.reduce((a, t) => a + t.d, 0),
    mood: LADDER.find(l => l.word === word) || (word === 'Exotic' ? EXOTIC : NONE),
    genre: most(tracks.map(t => t.g).filter(Boolean)),
    ...extra,
  }
}
const ALBUMS = [...groupBy(T, t => t.al.toLowerCase() + '|' + t.lib)].map(([, ts]) => summarise(ts[0].al, ts, 'Album')).sort((a, b) => b.n - a.n)
const ARTISTS = [...groupBy(T, t => t.ar.toLowerCase())].map(([, ts]) => summarise(ts[0].ar, ts, 'Artist', { artist: '' })).sort((a, b) => b.n - a.n)
const byTitle = q => T.find(t => t.t.toLowerCase().includes(q.toLowerCase()))
const queue = T.filter(t => t.lib === 'neuro soundcloud').slice(0, 46)
const PLAYLISTS = [
  summarise('Queue', queue, 'Playlist'),
  summarise('New playlist', T.filter(t => t.g === 'Progressive House').slice(3, 16), 'Playlist'),
]
const FLOWS_ = FLOWS.filter(f => f.name !== 'New flow' && !/copy/.test(f.name)).filter((f, i, a) => a.findIndex(g => g.name === f.name) === i)
const NOW = byTitle('Black Bloc') || T[0]

const fmtDur = s => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min` }
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const bpmRange = a => a.bpmLo === a.bpmHi ? `${a.bpmLo} BPM` : `${a.bpmLo}–${a.bpmHi} BPM`
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// ---- Generated identity ----------------------------------------------------
// A track is its own energy silhouette, mirrored, in its mood colour.
// A group (album, artist, playlist) is its tracks' silhouettes end to end.

function silhouette(vals, x, w, h, cy = h / 2) {
  if (!vals || !vals.length) vals = [20, 20]
  const n = vals.length, pts = []
  for (let i = 0; i < n; i++) pts.push([x + (i / (n - 1)) * w, (vals[i] / 100) * (h / 2)])
  const top = pts.map(([px, a]) => `${px.toFixed(1)},${(cy - a).toFixed(1)}`)
  const bot = pts.slice().reverse().map(([px, a]) => `${px.toFixed(1)},${(cy + a).toFixed(1)}`)
  return `M${top.join('L')}L${bot.join('L')}Z`
}
function line(vals, x, w, h, y0 = h) {
  const n = vals.length
  return 'M' + vals.map((v, i) => `${(x + (i / (n - 1)) * w).toFixed(1)},${(y0 - (v / 100) * h).toFixed(1)}`).join('L')
}
let gid = 0
/** A track sigil: mirrored energy in mood colour, lit from its loudest part. */
function sigil(t, w = 48, h = 32, opts = {}) {
  const id = 'g' + (gid++)
  return `<svg class="sigil" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${trackColor(t)}" stop-opacity=".55"/><stop offset="1" stop-color="${trackColor(t)}"/></linearGradient></defs>
    ${opts.bg !== false ? `<rect width="${w}" height="${h}" rx="${opts.r ?? 8}" fill="${trackColor(t)}" fill-opacity=".08"/>` : ''}
    <path d="${silhouette(t.curve, opts.pad ?? 4, w - 2 * (opts.pad ?? 4), h - 6)}" transform="translate(0,3)" fill="url(#${id})"/></svg>`
}
/** A group ribbon: every track's silhouette end to end, width by duration. */
function ribbon(tracks, w, h, opts = {}) {
  const gap = opts.gap ?? 1.5, total = tracks.reduce((a, t) => a + t.d, 0)
  const usable = w - gap * (tracks.length - 1)
  let x = 0, out = ''
  for (const t of tracks) {
    const tw = Math.max(1.5, usable * t.d / total)
    out += `<path d="${silhouette(t.curve, x, tw, h)}" fill="${trackColor(t)}" fill-opacity="${opts.alpha ?? 0.9}"/>`
    x += tw + gap
  }
  return `<svg class="ribbon" width="${opts.fluid ? '100%' : w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${out}</svg>`
}
/** A group sigil: a square-free glyph, the group's ribbon folded into a short wide tile. */
function groupSigil(g, w = 56, h = 40) {
  const ts = g.tracks.slice(0, 18)
  return `<span class="gsig" style="--c:${g.mood.color}">${ribbon(ts, w - 8, h - 10, { gap: 1 })}</span>`
}
/** A flow: its energy target as a line over a soft fill. */
function flowShape(f, w, h, color = 'var(--blue)') {
  let pts = f.energy.length ? f.energy : [[0, .5], [1, .5]]
  const P = pts.map(([x, y]) => [x * w, h - 3 - y * (h - 6)])
  const d = 'M' + P.map(p => p.map(v => v.toFixed(1)).join(',')).join('L')
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}L${w},${h}L0,${h}Z" fill="${color}" fill-opacity=".14"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/></svg>`
}

// ---- Icons -------------------------------------------------------------------
const I = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  media: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M10 8.5l4 2.5-4 2.5zM8 21h8"/>',
  discover: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  library: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/>',
  play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
  cast: '<path d="M3 8V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6M3 12a8 8 0 0 1 8 8M3 16a4 4 0 0 1 4 4M3 20h.01"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  shuffle: '<path d="M16 4h4v4M4 20L20 4M20 16v4h-4M14 14l6 6M4 4l5 5"/>',
  flow: '<path d="M3 17c3 0 4-10 7-10s4 10 7 10 3-6 4-6"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  lasso: '<path d="M5 9c0-3 3-5 7-5s7 2 7 5-3 5-7 5c-2 0-3.5-.4-4.6-1"/><path d="M7.5 13c-1 2-.5 4 1.5 5"/>',
}
const icon = (n, s = 20, sw = 2) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`

// ---- App chrome ----------------------------------------------------------------
function chrome() {
  const nav = [['home', 'Home'], ['media', 'Media'], ['discover', 'Discover'], ['music', 'Music'], ['library', 'Library']]
  const rail = `<aside class="rail"><div class="rail-in">
    <img src="../../../../frontend/public/sestudio-mark.svg" alt="sestudio" width="30" height="30" class="mark">
    <button class="rail-search">${icon('search', 22)}</button>
    ${nav.map(([k, l]) => `<a class="rail-item ${k === 'music' ? 'on' : ''}"><span>${icon(k)}</span>${l}</a>`).join('')}
    <a class="rail-item set">${icon('settings')}Settings</a></div></aside>`
  const bar = `<div class="player"><div class="pl-aura">${ribbon([NOW], 600, 40, { alpha: .25 })}</div>
    <span class="pl-art">${sigil(NOW, 36, 36, { r: 9 })}</span>
    <span class="pl-meta"><b>${esc(NOW.t)}</b><small><i style="color:${NOW.m.color}">${NOW.m.word}</i> · ${NOW.bpm} BPM</small></span>
    <button class="pl-play">${icon('play', 18)}</button><button class="pl-btn">${icon('cast', 20)}</button><span class="pl-stop"></span><button class="pl-btn">${icon('up', 20)}</button></div>`
  const dock = `<nav class="dock">${[['home', 'Home'], ['media', 'Media']].map(([k, l]) => `<a>${icon(k, 22)}<span>${l}</span></a>`).join('')}
    <a class="dock-search">${icon('search', 26, 2.4)}</a>${[['music', 'Music'], ['library', 'Library']].map(([k, l]) => `<a class="${k === 'music' ? 'on' : ''}">${icon(k, 22)}<span>${l}</span></a>`).join('')}</nav>`
  document.body.insertAdjacentHTML('afterbegin', rail)
  document.body.insertAdjacentHTML('beforeend', `<div class="bottom">${bar}${dock}</div>`)
}
const phone = () => matchMedia('(max-width: 700px)').matches

// Tunable values (tune.js sets window.TUNE on the tuning page; other pages get the defaults).
const tv = (k, d) => (window.TUNE && window.TUNE[k] != null ? window.TUNE[k] : d)
const hueOf = s => { let h = 0; for (const c of s || '') h = (h * 31 + c.charCodeAt(0)) % 360; return h }
/** A track's colour: its mood (default), its energy, or its genre. */
function trackColor(t) {
  const m = tv('color', 'mood')
  if (m === 'energy') { const e = (t.e || 0) / 100; return `oklch(${55 + e * 28}% ${.1 + e * .08} ${250 - e * 225})` }
  if (m === 'genre') return t.g ? `oklch(72% .13 ${hueOf(t.g)})` : 'oklch(50% .02 240)'
  return t.m.color
}
