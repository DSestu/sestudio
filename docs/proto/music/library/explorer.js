// Explorer for play3.html: the left column as a tree (libraries > artists > albums > tracks,
// lists, flows) plus online sources searched live through the real /api/music/search.

I.disk = '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>'
I.user = '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'
I.globe = '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>'
I.list = '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'
I.folder = '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'

const ONLINE = new Map()
const E = { open: new Set(['sec:lib', 'sec:lists', 'sec:online', 'lb:Deadmau5', 'on:ytmusic', 'on:youtube', 'on:soundcloud']), more: new Set(), q: '', loading: false, res: null, err: '', mob: false, timer: 0 }
const SRC = { ytmusic: ['YouTube Music', 'oklch(68% .2 25)'], youtube: ['YouTube', 'oklch(64% .22 28)'], soundcloud: ['SoundCloud', 'oklch(72% .17 50)'] }

function onlineQuery() { return tv('onlineSounds', false) ? S.text.trim() : parse(S.text).terms.join(' ') }
const srcOn = k => tv({ ytmusic: 'srcYtm', youtube: 'srcYt', soundcloud: 'srcSc' }[k], true)
function searchOnline() {
  const q = onlineQuery()
  if (q === E.q) return
  E.q = q; clearTimeout(E.timer)
  if (!q) { E.res = null; E.loading = false; return }
  E.loading = true
  E.timer = setTimeout(async () => {
    try {
      const r = await fetch(`/api/music/search?${new URLSearchParams({ q, source: 'all' })}`)
      const j = await r.json()
      if (q !== E.q) return
      const seen = new Set()
      E.res = j.online.filter(h => !seen.has(h.track_id) && seen.add(h.track_id)).map(h => {
        const t = { id: h.track_id, t: h.title, ar: h.artist || '', al: SRC[h.source]?.[0] || h.source, d: h.duration || 0, curve: [], m: NONE, bpm: 0, e: 0, online: true, thumb: h.thumb, src: h.source, kind: h.kind, url: h.url }
        ONLINE.set(t.id, t); return t
      })
      E.err = Object.entries(j.errors || {}).map(([k, v]) => `${SRC[k]?.[0] || k}: ${v}`).join(' · ')
    } catch (e) { E.err = 'Online search failed: ' + e.message; E.res = [] }
    E.loading = false; renderIndex()
  }, 550)
}

function tracksOfKey(k) {
  if (E.nodes && E.nodes.has(k)) return E.nodes.get(k).all
  if (k.startsWith('pl:')) return sourceOf(k).tracks
  return T.filter(t => k.split('|').every(p => p.startsWith('lb:') ? t.lib === p.slice(3) : p.startsWith('ar:') ? t.ar === p.slice(3) : p.startsWith('al:') ? t.al === p.slice(3) : true))
}
const fileLabel = (t, hl) => { const i = t.fn.lastIndexOf('.'), base = i > 0 ? t.fn.slice(0, i) : t.fn, ext = i > 0 ? t.fn.slice(i + 1) : ''; return hl(base) + (ext ? `<em class="ext">${esc(ext)}</em>` : '') }
function addrHtml() {
  const key = S.source && S.source.key && S.source.key.startsWith('g:files|') ? S.source.key : null
  if (!key) return `<div class="addr"><span class="dim">${icon('folder', 13)} Pick a folder, or open a library</span></div>`
  const parts = key.split('|').slice(1), lib = parts[0], root = (LIBPATHS[lib] || lib).split('\\')
  const segs = root.slice(0, -1).map(p => `<span class="dim">${esc(p)}</span>`)
  segs.push(`<button data-addr="g:files|${esc(lib)}">${esc(root.at(-1))}</button>`)
  parts.slice(1).forEach((p, i) => segs.push(`<button data-addr="g:files|${parts.slice(0, i + 2).map(esc).join('|')}">${esc(p)}</button>`))
  return `<div class="addr">${icon('folder', 13)}${segs.join('<span class="sep">›</span>')}<span style="flex:1"></span><button class="up" data-addr="${parts.length > 1 ? 'g:files|' + parts.slice(0, -1).map(esc).join('|') : ''}" title="Up one folder" ${parts.length > 1 ? '' : 'disabled'}>${icon('up', 13)}</button></div>`
}
function renderIndex() {
  initExplorer()
  searchOnline()
  const terms = parse(S.text).terms
  const hit = s => terms.every(w => s.toLowerCase().includes(w))
  const hl = s => { let o = esc(s); for (const w of terms) o = o.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), m => `<mark>${m}</mark>`); return o }
  const isOpen = k => E.open.has(k) || (terms.length && !E.open.has('x:' + k))
  let R = []
  const parts = {}
  const nd = (lvl, k, o) => R.push(`<div class="nd ${o.cls || ''} ${o.on ? 'on' : ''}" style="padding-left:${4 + lvl * 14}px" data-k="${esc(k)}" ${o.act ? `data-xa="${o.act}"` : ''} ${o.drag ? `draggable="true" data-id="${o.drag}"` : ''}${o.dragg ? `draggable="true" data-gk="${esc(o.dragg)}"` : ''}>
    <span class="chev ${o.chev === undefined ? 'none' : o.chev ? 'open' : ''}" data-tg>${icon('right', 12, 2.4)}</span>${o.ico ? `<span class="ico">${o.ico}</span>` : ''}<span class="lab">${o.label}</span>${o.ct != null ? `<span class="ct">${o.ct}</span>` : ''}${o.add ? `<button class="add" data-add2="${o.add}" title="Add to your set">${icon('plus', 13)}</button>` : ''}</div>`)
  const sec = (k, label, extra = '') => nd(0, k, { cls: 'sec', label: label + extra, chev: E.open.has(k), act: 'tg' })
  const onSrc = k => S.source && S.source.key === k

  // Library: libraries > artists > albums > tracks when browsing; flat matches when searching.
  R = parts.lib = []
  if (terms.length && tv('searchFlat', true)) {
    const tr = LIB.filter(t => hit(`${t.t} ${t.al} ${t.ar}`)), ars = ARTISTS.filter(a => a.name !== 'Various artists' && hit(a.name)), als = ALBUMS.filter(a => hit(a.name))
    sec('sec:lib', 'In your library', ` <i style="text-transform:none;letter-spacing:0;font-weight:400">${tr.length} tracks</i>`)
    if (E.open.has('sec:lib')) {
      for (const a of ars.slice(0, 4)) nd(1, 'ar:' + a.name, { label: hl(a.name) + '<i>artist</i>', ico: icon('user', 14), ct: a.n, act: 'src', on: onSrc('ar:' + a.name), dragg: 'ar:' + a.name })
      for (const a of als.slice(0, 4)) nd(1, 'lb:' + a.tracks[0].lib + '|al:' + a.name, { label: hl(a.name) + `<i>album · ${esc(a.artist)}</i>`, ico: groupSigil(a, 26, 18), ct: a.n, act: 'src', on: onSrc('lb:' + a.tracks[0].lib + '|al:' + a.name), add: 'g:lb:' + a.tracks[0].lib + '|al:' + a.name, dragg: 'lb:' + a.tracks[0].lib + '|al:' + a.name })
      const kt = 'sec:libtr', all = E.more.has(kt)
      for (const t of tr.slice(0, all ? 60 : 6)) nd(1, 'tr:' + t.id, { label: hl(t.t) + `<i>${esc(t.al)} · ${t.bpm || ''}</i>`, ico: sigil(t, 22, 14, { r: 3, bg: false, pad: 0 }), act: 'track', drag: t.id, add: t.id, on: S.sel === t, ct: fmtTime(t.d) })
      if (tr.length > 6 && !all) nd(1, kt, { cls: 'more', label: `${tr.length - 6} more tracks`, act: 'more' })
      if (!tr.length && !ars.length && !als.length) nd(1, 'none', { cls: 'dim', label: 'Nothing in your libraries' })
    }
  } else {
    sec('sec:lib', 'Library', ` <i style="text-transform:none;letter-spacing:0;font-weight:400">by ${esc(gmode().label.toLowerCase())}</i>`)
    E.nodes = new Map()
    const walk = (nodes, lvl, prefix) => {
      const lim = E.more.has(prefix) || ['Mood', 'Tempo', 'Energy'].includes(nodes[0]?.kind) ? 9999 : lvl === 0 ? tv('artistsShown', 8) : 40
      for (const n of nodes.slice(0, lim)) {
        const k = prefix + '|' + n.name, op = E.open.has(k)
        E.nodes.set(k, n)
        nd(lvl + 1, k, { label: hl(n.name), ico: groupIcon(n.kind, n), ct: n.all.length, chev: op, act: 'gsrc', on: onSrc(k), add: 'gg:' + k, dragg: k })
        if (!op) continue
        if (n.kids) walk(n.kids, lvl + 1, k)
        if (n.files || !n.kids) { const L = n.files || n.all, tl = E.more.has(k) ? 999 : n.files ? 40 : 12; for (const t of L.slice(0, tl)) nd(lvl + 2, 'tr:' + t.id, { label: (n.files ? fileLabel(t, hl) : hl(t.t)) + (tv('treeBpm', true) ? `<i>${t.bpm || ''}</i>` : ''), ico: sigil(t, 22, 14, { r: 3, bg: false, pad: 0 }), act: 'track', drag: t.id, add: t.id, on: S.sel === t, ct: fmtTime(t.d) }); if (L.length > tl) nd(lvl + 2, k, { cls: 'more', label: `${L.length - tl} more`, act: 'more' }) }
      }
      if (nodes.length > lim) nd(lvl + 1, prefix, { cls: 'more', label: `${nodes.length - lim} more`, act: 'more' })
    }
    if (E.open.has('sec:lib')) {
      if (!S.dims.length) { const k = 'g:flat', tl = E.more.has(k) ? 9999 : 60, all = sortTracks(LIB); for (const t of all.slice(0, tl)) nd(1, 'tr:' + t.id, { label: hl(t.t) + `<i>${esc(t.ar)}${tv('treeBpm', true) ? ' · ' + (t.bpm || '') : ''}</i>`, ico: sigil(t, 22, 14, { r: 3, bg: false, pad: 0 }), act: 'track', drag: t.id, add: t.id, on: S.sel === t, ct: fmtTime(t.d) }); if (all.length > tl) nd(1, k, { cls: 'more', label: `${all.length - tl} more`, act: 'more' }) }
      else walk(treeOf(filesMode() ? T : LIB), 0, 'g:' + gmodeId())
    }
  }

  // Lists and flows.
  R = parts.lists = []
  sec('sec:lists', 'Lists')
  if (E.open.has('sec:lists')) {
    for (const p of PLAYLISTS) { const k = 'pl:' + p.name; if (!terms.length || hit(p.name)) nd(1, k, { label: hl(p.name), ico: groupSigil(p, 26, 18), ct: p.n, act: 'src', on: onSrc(k), add: 'g:' + k, dragg: k }) }
  }
  sec('sec:flows', 'Flows')
  if (E.open.has('sec:flows')) for (const f of FLOWS_) if (!terms.length || hit(f.name)) nd(1, 'fl:' + f.name, { label: hl(f.name), ico: flowShape(f, 22, 14), act: 'flow' })

  R = parts.online = []
  // Online: the same search, sent to YouTube Music, YouTube and SoundCloud.
  sec('sec:online', 'Online', E.loading ? ' <span class="spin" style="display:inline-block;vertical-align:-2px;margin-left:6px"></span>' : '')
  if (E.open.has('sec:online')) {
    if (!E.q) for (const [k, [l, c]] of Object.entries(SRC).filter(([k]) => srcOn(k))) nd(1, 'on:' + k, { label: `${l}<i>type to search</i>`, ico: `<i class="src-dot" style="background:${c}"></i>`, cls: 'dim' })
    else if (E.loading && !E.res) for (const [k, [l, c]] of Object.entries(SRC).filter(([k]) => srcOn(k))) nd(1, 'on:' + k, { label: `${l}<i>searching “${esc(E.q)}”…</i>`, ico: '<span class="spin"></span>' })
    else if (E.res) {
      for (const [k, [l, c]] of Object.entries(SRC).filter(([k]) => srcOn(k))) {
        const hs = E.res.filter(h => h.src === k), kk = 'on:' + k, op = E.open.has(kk)
        nd(1, kk, { label: l, ico: `<i class="src-dot" style="background:${c}"></i>`, ct: hs.length, chev: hs.length ? op : undefined, act: 'tg', cls: hs.length ? '' : 'dim' })
        if (op) for (const h of hs.slice(0, E.more.has(kk) ? 30 : tv('onlinePer', 5))) nd(2, 'oh:' + h.id, { label: `${esc(h.t)}<i>${esc(h.ar)}${h.d ? ' · ' + fmtTime(h.d) : ''}${h.kind === 'video' ? ' · video' : ''}</i>`, ico: `<img class="th" src="${h.thumb}" alt="" loading="lazy">`, act: 'online', drag: h.id, add: h.id })
        if (op && hs.length > tv('onlinePer', 5) && !E.more.has(kk)) nd(2, kk, { cls: 'more', label: `${hs.length - tv('onlinePer', 5)} more on ${l}`, act: 'more' })
      }
      if (E.err) R.push(`<div class="exp-f" style="color:var(--coral)">${esc(E.err)}</div>`)
    }
  }
  $('idx').innerHTML = `<div class="exp-h"><b>Explorer</b>${terms.length ? `<small>matching “${esc(terms.join(' '))}”</small>` : `<small>${LIB.length} tracks</small>`}<span class="sp"></span><button data-collapse title="Collapse all">${icon('up', 15)}</button>${phone() ? `<button data-exp-close title="Close">${icon('close', 15)}</button>` : ''}</div>
    ${terms.length ? '' : groupUiHtml()}${!terms.length && filesMode() ? addrHtml() : ''}
    ${!terms.length && tv('groupUi', 'rail') === 'rail' ? `<div class="exp-body">${railHtml()}` : ''}<div class="tree">${(terms.length ? (tv('onlineFirst', false) ? [parts.online, parts.lib, parts.lists] : [parts.lib, parts.online, parts.lists]) : [parts.lib, parts.lists, parts.online]).flat().join('')}</div>
    ${!terms.length && tv('groupUi', 'rail') === 'rail' ? '</div>' : ''}
    <div class="exp-f">Click opens it on the tape. Drag a track into your set. Double-click plays.${E.q ? ' Online tracks are analysed when you add them.' : ''}</div>`
  $('idx').classList.toggle('open', E.mob)
  $('pchips').innerHTML = `<span class="chip on" data-exp-open>${icon('folder', 14)} Browse</span>` + PLAYLISTS.map(p => `<span class="chip ${onSrc('pl:' + p.name) ? 'on' : ''}" data-src="pl:${esc(p.name)}">${esc(p.name)}</span>`).join('') + ['dark', 'floating', '128', '172'].map(w => `<span class="chip" data-q="${w}">“${w}”</span>`).join('')
}

let expInit = false
function initExplorer() {
  if (expInit) return; expInit = true
  $('idx').className = 'exp'
  const q0 = new URLSearchParams(location.search).get('q'); if (q0) { S.text = q0; $('qi').value = q0 }
  if (new URLSearchParams(location.search).has('exp')) E.mob = true
  const src0 = new URLSearchParams(location.search).get('src'); if (src0) { const ps = src0.split('|'); for (let i = 2; i <= ps.length; i++) E.open.add(ps.slice(0, i).join('|')); setTimeout(() => { const n = E.nodes && E.nodes.get(src0); if (n) { S.source = { key: src0, kind: n.kind, name: n.name, tracks: n.all }; render() } }, 0) }
  // Tree clicks.
  $('idx').addEventListener('click', e => {
    if (e.target.closest('[data-collapse]')) { E.open = new Set(['sec:lib', 'sec:lists', 'sec:online']); [...E.open].length; E.more.clear(); renderIndex(); return }
    if (e.target.closest('[data-exp-close]')) { E.mob = false; renderIndex(); return }
    const add = e.target.closest('[data-add2]')
    if (add) {
      const v = add.dataset.add2
      if (v.startsWith('gg:')) { const n = E.nodes.get(v.slice(3)); let c = 0; for (const t of n.all) if (!S.set.includes(t)) { addToSet(t); c++ } toast(`${c} tracks added to your set`) }
      else if (v.startsWith('g:')) { const k = v.slice(2); const ts = k.startsWith('pl:') ? sourceOf(k).tracks : T.filter(t => k.split("|").every(p => p.startsWith('lb:') ? t.lib === p.slice(3) : p.startsWith('ar:') ? t.ar === p.slice(3) : t.al === p.slice(3))); let n = 0; for (const t of ts) if (!S.set.includes(t)) { addToSet(t); n++ } toast(`${n} tracks added to your set`) }
      else { const t = byId(v); if (S.set.includes(t)) toast('Already in your set'); else addToSet(t) }
      render(false); return
    }
    const ad = e.target.closest('[data-addr]'); if (ad) { const k = ad.dataset.addr; if (!k) return; const nn = E.nodes.get(k); if (nn) { S.source = { key: k, kind: nn.kind, name: nn.name, tracks: nn.all }; S.order = 'list'; E.open.add(k); $('tape').scrollLeft = 0; render() } return }
    const n = e.target.closest('.nd'); if (!n) return
    const k = n.dataset.k, act = n.dataset.xa
    const toggle = () => { const auto = parse(S.text).terms.length && !k.startsWith('sec:') && !k.startsWith('on:'); if (auto) { E.open.has('x:' + k) ? E.open.delete('x:' + k) : E.open.add('x:' + k) } else { E.open.has(k) ? E.open.delete(k) : E.open.add(k) } }
    if (e.target.closest('[data-tg]') || act === 'tg') { toggle(); renderIndex(); return }
    if (act === 'more') { E.more.add(k); renderIndex(); return }
    if (act === 'flow') { toast(`Plays the ${k.slice(3)} flow`); return }
    if (act === 'online') { const t = byId(k.slice(3)); toast(`Streams “${t.t}” from ${t.al}; + adds it to your set`); return }
    if (act === 'track') { S.sel = T.find(t => t.id === k.slice(3)); if (!view().includes(S.sel)) { S.source = null; S.text = ''; $('qi').value = '' } render(false); scrollToSel(); return }
    if (act === 'gsrc') { const n = E.nodes.get(k); S.source = { key: k, kind: n.kind, name: n.name, tracks: n.all }; S.order = 'list'; E.open.add(k); if (phone()) E.mob = false; $('tape').scrollLeft = 0; render(); return }
    if (act === 'src') {
      const parts = k.split('|'), last = parts.at(-1)
      const ts = T.filter(t => parts.every(p => p.startsWith('lb:') ? t.lib === p.slice(3) : p.startsWith('ar:') ? t.ar === p.slice(3) : p.startsWith('al:') ? t.al === p.slice(3) : true))
      const kind = last.startsWith('lb:') ? 'Library' : last.startsWith('ar:') ? 'Artist' : last.startsWith('al:') ? 'Album' : 'Playlist'
      S.source = kind === 'Playlist' ? sourceOf(k) : { key: k, kind, name: last.slice(3), tracks: ts }
      S.order = kind === 'Playlist' ? 'blend' : 'list'
      if (!E.open.has(k)) E.open.add(k)
      if (phone()) E.mob = false
      $('tape').scrollLeft = 0; render(); return
    }
  })
  $('idx').addEventListener('change', e => { if (e.target.matches('[data-group]')) { S.groupBy = e.target.value; render() } })
  $('idx').addEventListener('dblclick', e => { const n = e.target.closest('.nd[data-xa="track"]'); if (n) play(T.find(t => t.id === n.dataset.k.slice(3))) })
  document.addEventListener('click', e => { if (e.target.closest('[data-exp-open]')) { E.mob = true; renderIndex() } })
}
