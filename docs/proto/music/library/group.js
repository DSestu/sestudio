// Group & sort: composable levels (e.g. Mood › Artist), one choice for the explorer and the tape.

I.album = '<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="12" cy="12" r="3.2"/>'
I.mood = '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>'
I.tag = '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1.3" fill="currentColor" stroke="none"/>'
I.tempo = '<path d="M9 3h6l3 18H6z"/><path d="M12 16l5-9"/>'
I.bars = '<path d="M5 20v-4M10 20v-8M15 20V8M20 20V4"/>'
I.az = '<path d="M3 18l4-12 4 12M4.5 14h5M14 6h6l-6 12h6"/>'
I.sort = '<path d="M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3"/>'
I.layers = '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17.5l9 5 9-5" opacity=".5"/>'
I.key = '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>'

const LEVELS = ['Calm', 'Steady', 'Driving', 'Intense']
const BANDS = [[0, 100, 'Under 100'], [100, 120, '100–119'], [120, 126, '120–125'], [126, 131, '126–130'], [131, 140, '131–139'], [140, 160, '140–159'], [160, 180, '160–179'], [180, 999, '180 and up']]
const bandOf = b => b ? BANDS.find(([lo, hi]) => b >= lo && b < hi)[2] : 'No tempo'
const DIMS = {
  files: { label: 'Folders', kind: 'Library', ic: 'disk', of: t => t.lib },
  album: { label: 'Album', kind: 'Album', ic: 'album', of: t => t.al },
  artist: { label: 'Artist', kind: 'Artist', ic: 'user', of: t => t.ar },
  library: { label: 'Library', kind: 'Library', ic: 'disk', of: t => t.lib },
  mood: { label: 'Mood', kind: 'Mood', ic: 'mood', of: t => t.m.word, order: [...LADDER.map(l => l.word), 'Exotic', 'Unread'] },
  genre: { label: 'Genre', kind: 'Genre', ic: 'tag', of: t => t.g || 'No genre' },
  tempo: { label: 'Tempo', kind: 'Tempo', ic: 'tempo', of: t => bandOf(t.bpm), order: [...BANDS.map(b => b[2]), 'No tempo'] },
  energy: { label: 'Energy', kind: 'Energy', ic: 'bars', of: t => t.lvl || 'Unread', order: [...LEVELS, 'Unread'] },
  key: { label: 'Key', kind: 'Key', ic: 'key', of: t => t.key || 'Unread' },
  letter: { label: 'A–Z', kind: 'Letter', ic: 'az', of: t => /^[a-z]/i.test(t.t) ? t.t[0].toUpperCase() : '#' },
}
const PRESETS = [['album', 'Album', ['album']], ['artist', 'Artist', ['artist', 'album']], ['library', 'Library', ['files']], ['mood', 'Mood', ['mood']], ['genre', 'Genre', ['genre', 'artist']], ['tempo', 'Tempo', ['tempo']], ['energy', 'Energy', ['energy']], ['key', 'Key', ['key']], ['az', 'A–Z', ['letter']], ['flat', 'Flat', []]]
const OLD = { hier: 'library', plain: 'az' }
const GSORTS = [['natural', 'Natural'], ['az', 'A–Z'], ['count', 'Most tracks']]
const TSORTS = [['natural', 'Natural'], ['title', 'Title'], ['bpm', 'BPM'], ['energy', 'Energy'], ['length', 'Length'], ['mood', 'Bright → dark']]
function ensureDims() { if (S.dims) return; const p = PRESETS.find(p => p[0] === (OLD[tv('groupDef', 'album')] || tv('groupDef', 'album'))) || PRESETS[0]; S.dims = p[2].slice(); S.gsort = 'natural'; S.tsort = 'natural' }

const dimsKey = () => (ensureDims(), S.dims.join('>') || 'flat')
const dimsLabel = () => (ensureDims(), S.dims.length ? S.dims.map(d => DIMS[d].label).join(' › ') : 'Flat list')
const presetOf = () => PRESETS.find(p => p[2].join('>') === S.dims.join('>'))?.[0]
// Kept for older callers.
const gmodeId = dimsKey
const gmode = () => ({ label: dimsLabel() })
const sortLabel = () => S.gsort === 'natural' && S.tsort === 'natural' ? 'natural order' : `groups ${GSORTS.find(s => s[0] === S.gsort)[1].toLowerCase()} · tracks ${TSORTS.find(s => s[0] === S.tsort)[1].toLowerCase()}`

function sortTracks(ts) {
  const leaf = S.dims.at(-1), cmp = {
    title: (a, b) => a.t.localeCompare(b.t), bpm: (a, b) => (a.bpm || 0) - (b.bpm || 0), energy: (a, b) => (a.e || 0) - (b.e || 0),
    length: (a, b) => a.d - b.d, mood: (a, b) => b.m.b - a.m.b || (a.e || 0) - (b.e || 0),
  }
  const k = S.tsort !== 'natural' ? S.tsort : ['album', 'letter', undefined].includes(leaf) || leaf === 'artist' || leaf === 'library' ? 'title' : 'bpm'
  return ts.slice().sort(cmp[k])
}
/** The tracks as a tree: [{ name, kind, all, kids | null }]. */
/** Library as on disk: library › folders (nested) › files, folders first, A–Z like a file explorer. */
function fileTree(ts) {
  const dir = (name, kind, tracks, depth) => {
    const here = [], sub = new Map()
    for (const t of tracks) { const p = (t.f || '').split('/').filter(Boolean)[depth]; if (p === undefined) here.push(t); else { if (!sub.has(p)) sub.set(p, []); sub.get(p).push(t) } }
    const kids = [...sub].sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' })).map(([n, g]) => dir(n, 'Folder', g, depth + 1))
    return { name, kind, all: tracks, kids: kids.length ? kids : null, files: here.slice().sort((a, b) => a.fn.localeCompare(b.fn, 'en', { sensitivity: 'base' })) }
  }
  return [...groupBy(ts, t => t.lib)].sort((a, b) => a[0].localeCompare(b[0])).map(([l, g]) => dir(l, 'Library', g, 0))
}
const filesMode = () => (ensureDims(), S.dims[0] === 'files')
function treeOf(ts, level = 0) {
  ensureDims()
  if (S.dims[0] === 'files') return fileTree(ts)
  if (!S.dims.length) return [{ name: 'All tracks', kind: 'All', all: sortTracks(ts), kids: null }]
  const d = DIMS[S.dims[level]]
  let e = [...groupBy(ts, d.of)]
  const az = (a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' }), cnt = (a, b) => b[1].length - a[1].length
  if (S.gsort === 'az') e.sort(az)
  else if (S.gsort === 'count') e.sort(cnt)
  else if (d.order) e.sort((a, b) => d.order.indexOf(a[0]) - d.order.indexOf(b[0]))
  else e.sort(['Album', 'Letter', 'Key'].includes(d.kind) ? az : cnt)
  return e.map(([name, g]) => ({ name, kind: d.kind, all: sortTracks(g), kids: level < S.dims.length - 1 ? treeOf(g, level + 1) : null }))
}
/** The tape's groups: leaves in tree order, each with the header above it. */
function tapeGroups(ts) {
  const out = [], depth = S.dims.length
  if (filesMode()) { const walkF = (n, path) => { if (n.files.length) out.push({ head: path[0], name: path.slice(1).join(' / ') || 'Top level', kind: 'Folder', ts: n.files }); (n.kids || []).forEach(c => walkF(c, [...path, c.name])) }; fileTree(ts).forEach(n => walkF(n, [n.name])); return out }
  const walk = (nodes, trail) => nodes.forEach(n => n.kids ? walk(n.kids, [...trail, n.name]) : out.push({ head: depth > 1 ? trail.at(-1) : n.name, name: depth > 1 ? n.name : '', kind: n.kind, ts: n.all }))
  walk(treeOf(ts), [])
  return out
}
function groupIcon(kind, n) {
  if (kind === 'Library') return icon('disk', 15)
  if (kind === 'Folder') return icon('folder', 15)
  if (kind === 'Artist') return icon('user', 14)
  if (kind === 'Album') return groupSigil(summarise(n.name, n.all, 'Album'), 26, 18)
  if (kind === 'Mood') return `<i class="dot" style="background:${n.all[0].m.color}"></i>`
  if (kind === 'Genre') return `<i class="dot" style="background:oklch(72% .13 ${hueOf(n.name)})"></i>`
  if (kind === 'Energy') { const i = LEVELS.indexOf(n.name); return `<svg width="18" height="12" viewBox="0 0 18 12">${[0, 1, 2, 3].map(k => `<rect x="${k * 5}" y="${9 - k * 3}" width="3.4" height="${3 + k * 3}" rx="1" fill="${k <= i ? 'var(--blue)' : 'oklch(40% .02 240)'}"/>`).join('')}</svg>` }
  if (kind === 'Tempo') return `<span style="font-size:10px;color:var(--blue);font-weight:600">BPM</span>`
  if (kind === 'Key') return icon('key', 13)
  return ''
}
function legendHtml(ts) {
  const c = tv('color', 'mood')
  if (c === 'energy') return `<span class="lg-l">Energy</span><span class="lg-grad"></span><span class="lg-l">Calm → Intense</span>`
  if (c === 'genre') return [...groupBy(ts.filter(t => t.g), t => t.g)].sort((a, b) => b[1].length - a[1].length).slice(0, 8).map(([g, gs]) => `<span class="lg-i"><i class="dot" style="background:oklch(72% .13 ${hueOf(g)})"></i>${esc(g)} <b class="tab">${gs.length}</b></span>`).join('')
  const counts = {}; ts.forEach(t => counts[t.m.word] = (counts[t.m.word] || 0) + 1)
  return [...LADDER, EXOTIC].filter(l => counts[l.word]).map(l => `<span class="lg-i"><i class="dot" style="background:${l.color}"></i>${l.word} <b class="tab">${counts[l.word]}</b></span>`).join('')
}

// ---- the controls, in four styles (Tune › Explorer › Group & sort controls) -----------------------
const sortBtn = (compact) => `<button class="gs-sort" data-gpop="sort" title="Sort">${icon('sort', 14)}${compact ? '' : `<span>${sortLabel()}</span>`}</button>`
function groupUiHtml() {
  ensureDims()
  const v = tv('groupUi', 'rail'), pre = presetOf()
  if (v === 'menu') return `<div class="gs-row"><select class="gsel" data-gpreset>${PRESETS.map(([k, l, d]) => `<option value="${k}" ${k === pre ? 'selected' : ''}>${l}${d.length > 1 ? ' › ' + d.slice(1).map(x => DIMS[x].label).join(' › ') : ''}</option>`).join('')}${pre ? '' : `<option selected>${dimsLabel()}</option>`}</select>${sortBtn(false)}</div>`
  if (v === 'chips') return `<div class="gs-chips">${PRESETS.map(([k, l]) => `<button class="gs-chip ${k === pre ? 'on' : ''}" data-gpreset="${k}">${k === 'flat' ? icon('list', 13) : icon(DIMS[PRESETS.find(p => p[0] === k)[2][0]].ic, 13)}${l}</button>`).join('')}${sortBtn(false)}</div>`
  if (v === 'rail') return ''
  // builder: the levels as a little sentence you edit in place
  return `<div class="gs-build"><span class="gs-l">Group</span>${S.dims.map((d, i) => `${i ? `<span class="gs-sep">›</span>` : ''}<span class="gs-lv"><button data-gpop="set:${i}">${icon(DIMS[d].ic, 13)}${DIMS[d].label}</button><button class="x" data-grm="${i}" title="Remove this level">${icon('close', 11)}</button></span>`).join('')}${S.dims.length < 4 ? `<button class="gs-add" data-gpop="add" title="Add a level">${icon('plus', 13)}${S.dims.length ? '' : 'Add a level'}</button>` : ''}</div>
    <div class="gs-build"><span class="gs-l">Sort</span><button class="gs-pill" data-gpop="sort">Groups: ${GSORTS.find(s => s[0] === S.gsort)[1]}</button><button class="gs-pill" data-gpop="sort">Tracks: ${TSORTS.find(s => s[0] === S.tsort)[1]}</button></div>`
}
function railHtml() {
  ensureDims()
  const pre = presetOf()
  return `<nav class="grail">${PRESETS.map(([k, l, d]) => `<button class="${k === pre ? 'on' : ''}" data-gpreset="${k}" title="${l}${d.length > 1 ? ' › ' + d.slice(1).map(x => DIMS[x].label).join(' › ') : ''}">${k === 'flat' ? icon('list', 17) : icon(DIMS[d[0]].ic, 17)}<span>${l}</span></button>`).join('')}<button class="${pre ? '' : 'on'}" data-gpop="stack" title="Stack levels${pre ? '' : ': ' + dimsLabel()}">${icon('layers', 17)}<span>Custom</span></button><span style="flex:1"></span><button data-gpop="sort" title="Sort: ${sortLabel()}">${icon('sort', 17)}<span>Sort</span></button></nav>`
}
// ---- popover -------------------------------------------------------------------------------------
function gpop(kind, anchor) {
  closeGpop()
  const el = document.createElement('div'); el.id = 'gpop'
  if (kind === 'stack') el.innerHTML = `<p>Stack levels · click in order</p>${Object.keys(DIMS).map(d => { const i = S.dims.indexOf(d); return `<button data-gstack="${d}" class="${i >= 0 ? 'on' : ''}">${icon(DIMS[d].ic, 14)}${DIMS[d].label}${i >= 0 ? `<em class="gs-n">${i + 1}</em>` : ''}</button>` }).join('')}<hr><button data-gstack="">${icon('list', 14)}Flat, no levels</button><p class="gs-now">${esc(dimsLabel())}</p>`
  else if (kind === 'sort') el.innerHTML = `<p>Groups</p>${GSORTS.map(([k, l]) => `<button data-gsort="${k}" class="${S.gsort === k ? 'on' : ''}">${l}</button>`).join('')}<p>Tracks</p>${TSORTS.map(([k, l]) => `<button data-tsort="${k}" class="${S.tsort === k ? 'on' : ''}">${l}</button>`).join('')}`
  else {
    const i = kind.startsWith('set:') ? +kind.slice(4) : -1
    const free = Object.keys(DIMS).filter(d => !S.dims.includes(d) || S.dims[i] === d)
    el.innerHTML = `<p>${i < 0 ? 'Add a level' : 'Group this level by'}</p>${free.map(d => `<button data-gdim="${d}" data-gi="${i}" class="${S.dims[i] === d ? 'on' : ''}">${icon(DIMS[d].ic, 14)}${DIMS[d].label}</button>`).join('')}${i >= 0 ? `<hr>${i > 0 ? `<button data-gmove="${i}">Move up a level</button>` : ''}<button data-grm="${i}">Remove this level</button>` : ''}`
  }
  document.body.appendChild(el)
  const r = anchor.getBoundingClientRect()
  el.style.left = Math.min(innerWidth - el.offsetWidth - 8, r.left) + 'px'
  el.style.top = Math.min(innerHeight - el.offsetHeight - 8, r.bottom + 6) + 'px'
  requestAnimationFrame(() => el.classList.add('on'))
}
function closeGpop() { document.getElementById('gpop')?.remove() }
function regroup() { closeGpop(); E.open = new Set([...E.open].filter(k => !k.startsWith('g:'))); $('tape').scrollLeft = 0; render() }
document.addEventListener('pointerdown', e => { if (!e.target.closest?.('#gpop, [data-gpop]')) closeGpop() })
document.addEventListener('click', e => {
  const q = s => e.target.closest(s)
  if (q('[data-gpop]')) { const b = q('[data-gpop]'); if (document.getElementById('gpop')) closeGpop(); else gpop(b.dataset.gpop, b); return }
  if (q('button[data-gpreset]')) { S.dims = PRESETS.find(p => p[0] === q('[data-gpreset]').dataset.gpreset)[2].slice(); regroup(); return }
  if (q('[data-gstack]')) { const d = q('[data-gstack]').dataset.gstack; if (!d) S.dims = []; else if (S.dims.includes(d)) S.dims.splice(S.dims.indexOf(d), 1); else if (S.dims.length < 4) S.dims.push(d); regroup(); gpop('stack', document.querySelector('[data-gpop="stack"]')); return }
  if (q('[data-gdim]')) { const b = q('[data-gdim]'), i = +b.dataset.gi; if (i < 0) S.dims.push(b.dataset.gdim); else S.dims[i] = b.dataset.gdim; regroup(); return }
  if (q('[data-grm]')) { S.dims.splice(+q('[data-grm]').dataset.grm, 1); regroup(); return }
  if (q('[data-gmove]')) { const i = +q('[data-gmove]').dataset.gmove; [S.dims[i - 1], S.dims[i]] = [S.dims[i], S.dims[i - 1]]; regroup(); return }
  if (q('[data-gsort]')) { S.gsort = q('[data-gsort]').dataset.gsort; render(); gpop('sort', document.querySelector('[data-gpop="sort"]') || q('#gpop')); return }
  if (q('[data-tsort]')) { S.tsort = q('[data-tsort]').dataset.tsort; render(); gpop('sort', document.querySelector('[data-gpop="sort"]') || q('#gpop')); return }
})
document.addEventListener('change', e => { if (e.target.matches('select[data-gpreset]')) { const p = PRESETS.find(p => p[0] === e.target.value); if (p) { S.dims = p[2].slice(); regroup() } } })
