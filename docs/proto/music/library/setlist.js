// The set as a list under the lane: three styles (rows, table, joins), problems found and fixed.
// Problems use the app's words: a clash is two neighbours sharing 5 notes or fewer (amber);
// tempo and energy jumps are the other rough joins. Fixes: a bridge between, a better spot, or Keep.

const SL = { open: null, only: false, kept: new Set(), sort: null }
const KINDS = { clash: ['Clash', 'oklch(83% .16 85)'], tempo: ['Tempo jump', 'oklch(70% .17 25)'], energy: ['Energy jump', 'oklch(72% .15 330)'] }

function joinInfo(a, b) {
  const ha = harmonyOf(a), hb = harmonyOf(b)
  const shared = ha && hb ? ha.notes.filter(n => hb.notes.includes(n)).length : null
  const dt = a.bpm && b.bpm ? Math.round(tdist(b.bpm, a.bpm)) : null
  const de = Math.round((b.ei ?? b.e ?? 0) - (a.eo ?? a.e ?? 0))
  const raw = []
  const hk = harmKind(a, b)
  if (hk && hk.kind === 'clash') raw.push({ k: 'clash', t: hk.label })
  if (dt != null && dt > 8) raw.push({ k: 'tempo', t: `${a.bpm} → ${b.bpm} BPM` })
  if (!a.online && !b.online && Math.abs(de) > 25) raw.push({ k: 'energy', t: `${de > 0 ? '+' : ''}${de} energy` })
  const key = a.id + '>' + b.id, kept = SL.kept.has(key)
  return { a, b, key, kept, shared, hk, dt, de, raw, issues: kept ? [] : raw, d: joinD(a, b), lean: de > 6 ? 'Lift' : de < -6 ? 'Ease' : 'Hold', genre: a.g && b.g && a.g !== b.g ? `${a.g} → ${b.g}` : '' }
}
const joinsOf = o => o.slice(1).map((b, i) => joinInfo(o[i], b))
/** Problems a join would have (Keep ignored): what fixes must get rid of. */
const probs = (a, b) => joinInfo(a, b).raw.length
/** Library tracks that would sit between a and b: those leaving no problem first, then the smoothest. */
function bridgesFor(j, n = 3) {
  const ha = harmonyOf(j.a), hb = harmonyOf(j.b), inSet = new Set(S.set.map(t => t.id))
  return LIB.filter(x => !inSet.has(x.id) && x.bpm).map(x => {
    const hx = harmonyOf(x), sa = ha && hx ? ha.notes.filter(k => hx.notes.includes(k)).length : 4, sb = hb && hx ? hb.notes.filter(k => hx.notes.includes(k)).length : 4
    const left = probs(j.a, x) + probs(x, j.b)
    return { x, sa, sb, left, s: (joinD(j.a, x) + joinD(x, j.b)) / 2 }
  }).sort((p, q) => p.left - q.left || p.s - q.s).slice(0, n)
}
/** Where a track would leave the fewest problems (then the smoothest joins). */
function bestSpot(o, t) {
  const rest = o.filter(x => x !== t), cost = arr => arr.slice(1).reduce((c, x, i) => c + probs(arr[i], x) * 10 + joinD(arr[i], x), 0)
  let best = 0, bc = Infinity
  for (let p = 0; p <= rest.length; p++) { const c = cost([...rest.slice(0, p), t, ...rest.slice(p)]); if (c < bc) { bc = c; best = p } }
  return { arr: [...rest.slice(0, best), t, ...rest.slice(best)], at: best, cost: bc, was: cost(o) }
}
function freeze(o) { S.set = o; if (S.setOrder !== 'mine') { S.setOrder = 'mine'; toast('Switched to your order so the fix stays put') } }
function insertBridge(j, x) { const o = ordered(); o.splice(o.indexOf(j.b), 0, x); freeze(o); SL.open = null; D.landed = `${x.t} → between ${j.a.t} and ${j.b.t}`; D.landedAt = Date.now(); D.flash = x.id; render(false) }
function moveBetter(j) {
  const r = bestSpot(ordered(), j.b)
  if (r.cost >= r.was) { toast(`No better spot for ${j.b.t}; try a bridge or Keep`); return }
  freeze(r.arr); SL.open = null; toast(`Moved ${j.b.t} to #${r.at + 1}`); D.flash = j.b.id; render(false)
}
function fixAll() {
  let o = ordered(), bridges = 0, moves = 0
  const count = arr => joinsOf(arr).filter(j => j.issues.length).length
  for (let guard = 0; guard < 30; guard++) {
    const bad = joinsOf(o).filter(j => j.issues.length && !j.skip)
    let done = false
    for (const j of bad) {
      const br = bridgesFor(j, 1)[0]
      if (br && br.left === 0) { o = o.slice(); o.splice(o.indexOf(j.b), 0, br.x); S.set = o; bridges++; done = true; break }
      const r = bestSpot(o, j.b)
      if (r.cost < r.was - .01 && count(r.arr) < count(o)) { o = r.arr; S.set = o; moves++; done = true; break }
    }
    if (!done) break
  }
  freeze(o.slice()); render(false)
  const left = count(o)
  toast(bridges || moves ? `${bridges ? `Added ${bridges} bridge${bridges > 1 ? "s" : ""}` : ""}${bridges && moves ? ", m" : moves ? "M" : ""}${moves ? `oved ${moves} track${moves > 1 ? 's' : ''}` : ''}. ${left ? `${left} left: Keep them or fix by hand` : 'No problems left'}` : 'Nothing here fixes these; Keep them or pick a bridge by hand')
}

// ---- pieces ---------------------------------------------------------------------------------------------
const issueChips = j => j.raw.map(i => `<span class="sl-i ${j.kept ? 'kept' : ''}" style="--c:${KINDS[i.k][1]}">${KINDS[i.k][0]} · ${i.t}</span>`).join('')
const infoChips = j => `<span class="sl-c"><i class="sl-d" style="background:${jm(j.a, j.b)}"></i>${Math.round((1 - j.d) * 100)}</span>${j.hk && j.hk.kind !== 'clash' ? `<span class="sl-c ${j.hk.kind === 'lift' || j.hk.kind === 'drop' ? 'tr' : ''}">${j.hk.label}</span>` : ''}${j.dt != null && j.dt <= 8 ? `<span class="sl-c">${j.dt ? `${j.a.bpm} → ${j.b.bpm}` : 'Same tempo'}</span>` : ''}<span class="sl-c">${j.lean}${Math.abs(j.de) > 2 && Math.abs(j.de) <= 25 ? ` ${j.de > 0 ? '+' : ''}${j.de}` : ''}</span>${j.genre ? `<span class="sl-c">${esc(j.genre)}</span>` : ''}`
function fixPanel(j) {
  const br = bridgesFor(j)
  return `<div class="sl-fix">
    <p class="sl-fix-h">${j.issues.map(i => KINDS[i.k][0].toLowerCase()).join(' and ')} between <b>${esc(j.a.t)}</b> and <b>${esc(j.b.t)}</b></p>
    <p class="sl-fix-l">Put one of these between</p>
    ${br.map(({ x, sa, sb, s, left }) => `<div class="sl-br" data-id="${x.id}">${sigil(x, 48, 30, { r: 7 })}<span><b>${esc(x.t)}</b><small><i class="dot" style="background:${x.m.color}"></i> ${x.m.word} · ${x.bpm} BPM · shares ${sa} and ${sb} notes</small></span><em class="${left ? 'soft' : ''}">${left ? `softer · ${left} left` : 'fixes it'}</em><button class="btn pri" data-slins="${j.key}|${x.id}">Insert</button></div>`).join('')}
    <div class="sl-fix-b"><button class="btn" data-slmove="${j.key}">Move ${esc(j.b.t.length > 22 ? j.b.t.slice(0, 21) + '…' : j.b.t)} to a better spot</button><button class="btn ghost" data-slkeep="${j.key}">Keep, I like it</button></div></div>`
}
function joinLine(j) {
  const open = SL.open === j.key
  return `<div class="sl-j ${j.issues.length ? 'bad' : ''} ${open ? 'open' : ''}" data-jk="${j.key}" style="${j.issues.length ? `--c:${KINDS[j.issues[0].k][1]}` : ''}">
    <span class="sl-jl"></span>${issueChips(j)}${infoChips(j)}<span style="flex:1"></span>${j.issues.length ? `<button class="sl-fixb" data-slopen="${j.key}">${open ? 'Close' : 'Fix'}</button>` : j.kept ? `<button class="sl-unkeep" data-slunkeep="${j.key}">Kept · undo</button>` : ''}</div>${open ? fixPanel(j) : ''}`
}
const pinBtn = t => `<button class="pin ${D.pins.has(t.id) ? 'on' : ''}" data-pin="${t.id}" title="${D.pins.has(t.id) ? 'Unpin' : 'Pin here'}">${icon('pin', 14)}</button>`
const rmBtn = t => `<button data-rm="${t.id}" title="Remove">${icon('close', 13)}</button>`
const cls = t => `it ${t.online ? 'pend' : ''} ${D.sel.has(t.id) ? 'dsel' : ''} ${D.pins.has(t.id) ? 'pinned' : ''} ${S.playing === t ? 'now' : ''} ${D.flash === t.id ? 'flash' : ''}`
const energyBar = t => `<span class="sl-eb" title="Energy ${t.e ?? '?'}"><i style="width:${t.e || 0}%;background:${trackColor(t)}"></i></span>`

function rowsHtml(o, js) {
  return o.map((t, i) => {
    const j = js[i - 1], show = !SL.only || (j && j.issues.length) || (js[i] && js[i].issues.length)
    return (i && (show || !SL.only) ? joinLine(j) : '') + (show ? `<div class="${cls(t)} sl-row" data-i="${i}" data-id="${t.id}">
      <span class="grip" title="Drag to reorder">${icon('grip', 16)}</span><span class="n tab">${i + 1}</span>${t.online ? `<img class="sl-th" src="${t.thumb}" alt="">` : sigil(t, 64, 34, { r: 8 })}
      <span class="t"><b>${esc(t.t)}</b><small><i class="dot" style="background:${t.m.color}"></i> ${t.m.word} · ${t.key ? esc(t.key) : '?'}${t.cam ? ' ' + t.cam : ''} · ${t.bpm || '?'} BPM · ${esc(t.ar)}</small></span>
      ${energyBar(t)}<span class="sl-len tab">${fmtTime(t.d)}</span>${pinBtn(t)}${rmBtn(t)}</div>` : '')
  }).join('')
}
const COLS = [['n', '#'], ['t', 'Title'], ['key', 'Key'], ['mood', 'Mood'], ['bpm', 'BPM'], ['d', 'Time'], ['join', 'Next join']]
function tableHtml(o, js) {
  const head = `<div class="sl-th-row"><span></span>${COLS.map(([k, l]) => `<button data-slsort="${k}" class="${SL.sort === k ? 'on' : ''}">${l}</button>`).join('')}<span></span></div>`
  return head + o.map((t, i) => {
    const j = js[i], show = !SL.only || (j && j.issues.length) || (js[i - 1] && js[i - 1].issues.length)
    if (!show) return ''
    return `<div class="${cls(t)} sl-tr ${j && j.issues.length ? 'bad' : ''}" data-i="${i}" data-id="${t.id}" style="${j && j.issues.length ? `--c:${KINDS[j.issues[0].k][1]}` : ''}">
      <span class="grip">${icon('grip', 14)}</span><span class="tab">${i + 1}</span><span class="t"><b>${esc(t.t)}</b></span><span>${esc(t.key || '—')} <small>${t.cam || ''}</small></span>
      <span><i class="dot" style="background:${t.m.color}"></i> ${t.m.word}</span><span class="tab">${t.bpm || '—'}</span><span class="tab">${fmtTime(t.d)}</span>
      <span class="sl-jc">${j ? `<i class="sl-d" style="background:${jm(j.a, j.b)}"></i><b class="tab">${Math.round((1 - j.d) * 100)}</b>${j.issues.map(x => `<i class="sl-pip" style="--c:${KINDS[x.k][1]}" title="${KINDS[x.k][0]} · ${x.t}"></i>`).join('')}${j.issues.length ? `<button class="sl-fixb" data-slopen="${j.key}">Fix</button>` : ''}` : ''}</span>
      <span class="sl-act">${pinBtn(t)}${rmBtn(t)}</span></div>${j && SL.open === j.key ? fixPanel(j) : ''}`
  }).join('')
}
function joinsHtml(o, js) {
  if (o.length < 2) return rowsHtml(o, js)
  const tr = (t, c) => `<span class="sl-jt ${c}">${t.online ? `<img class="sl-th" src="${t.thumb}" alt="">` : sigil(t, 40, 26, { r: 6 })}<span><b>${esc(t.t)}</b><small>${t.m.word} · ${t.key || '?'} · ${t.bpm || '?'}</small></span></span>`
  return js.map((j, i) => (!SL.only || j.issues.length) ? `<div class="${cls(j.b)} sl-jr ${j.issues.length ? 'bad' : ''}" data-i="${i + 1}" data-id="${j.b.id}" style="${j.issues.length ? `--c:${KINDS[j.issues[0].k][1]}` : ''}">
      <span class="tab sl-jn">${i + 1}→${i + 2}</span>${tr(j.a, "ja")}<span class="sl-arrow"><i class="sl-d" style="background:${jm(j.a, j.b)}"></i><b class="tab">${Math.round((1 - j.d) * 100)}</b></span>${tr(j.b, "jb")}
      <span class="sl-jcs">${issueChips(j)}${infoChips(j)}</span>${j.issues.length ? `<button class="sl-fixb" data-slopen="${j.key}">${SL.open === j.key ? 'Close' : 'Fix'}</button>` : j.kept ? `<button class="sl-unkeep" data-slunkeep="${j.key}">Kept · undo</button>` : '<span></span>'}</div>${SL.open === j.key ? fixPanel(j) : ''}` : '').join('')
}

function renderSetList() {
  let el = document.getElementById('setlist')
  if (!el) { const lc = document.getElementById('laneC'); if (!lc) return; lc.insertAdjacentHTML('afterend', '<section id="setlist" class="setlist"></section>'); el = document.getElementById('setlist') }
  const style = tv('setList', 'rows')
  el.hidden = style === 'off' || D.v !== 'C'
  if (el.hidden) return
  const o = ordered(), js = joinsOf(o), bad = js.filter(j => j.issues.length)
  const count = k => bad.filter(j => j.issues.some(i => i.k === k)).length
  const rail = o.length > 1 ? `<div class="sl-rail" title="Where the problems are">${js.map((j, i) => j.issues.length ? `<button style="left:${(i + .5) / js.length * 100}%;--c:${KINDS[j.issues[0].k][1]}" data-slgo="${j.key}" title="${esc(j.a.t)} → ${esc(j.b.t)}"></button>` : '').join('')}</div>` : ''
  el.innerHTML = `<div class="sl-h"><h2>Tracks in your set</h2><small>${o.length} · ${fmtDur(o.reduce((a, t) => a + t.d, 0))}</small>
      <div class="seg sl-seg">${[['rows', 'Rows'], ['table', 'Table'], ['joins', 'Joins']].map(([k, l]) => `<button data-slstyle="${k}" class="${style === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    ${o.length > 1 ? `<div class="sl-prob ${bad.length ? 'has' : ''}">${bad.length ? Object.entries(KINDS).filter(([k]) => count(k)).map(([k, [l, c]]) => `<span class="sl-i" style="--c:${c}">${count(k)} ${l.toLowerCase()}${count(k) > 1 ? (k === 'clash' ? 'es' : 's') : ''}</span>`).join('') : `<span class="sl-ok">${icon('play', 10)} No clashes or jumps</span>`}
      ${rail}<button class="dtog ${SL.only ? 'on' : ''}" data-slonly>Only problems</button>${bad.length ? `<button class="btn pri sl-fa" data-slfixall>Fix all</button>` : ''}</div>` : ''}
    <div class="slist sl-${style}" data-drop="list" data-axis="y">${o.length ? (style === 'table' ? tableHtml(o, js) : style === 'joins' ? joinsHtml(o, js) : rowsHtml(o, js)) : `<div class="dropzone" style="min-height:120px">Drop tracks, albums or a selection here, or press + anywhere.</div>`}</div>`
  sortable(el.querySelector('[data-axis]'))
}
// Re-render with the set.
const _renderTray = renderTray
renderTray = function () { _renderTray(); renderSetList() }

document.addEventListener('click', e => {
  const q = s => e.target.closest(s); let b
  const J = k => joinsOf(ordered()).find(j => j.key === k)
  if ((b = q('[data-slstyle]'))) { TUNE.setList = b.dataset.slstyle; if (typeof save === 'function') { save(); renderTune() } renderSetList() }
  else if ((b = q('[data-slopen]'))) { SL.open = SL.open === b.dataset.slopen ? null : b.dataset.slopen; renderSetList() }
  else if ((b = q('[data-slins]'))) { const [k, id] = [b.dataset.slins.slice(0, b.dataset.slins.lastIndexOf('|')), b.dataset.slins.split('|').at(-1)]; insertBridge(J(k), byId(id)) }
  else if ((b = q('[data-slmove]'))) moveBetter(J(b.dataset.slmove))
  else if ((b = q('[data-slkeep]'))) { SL.kept.add(b.dataset.slkeep); SL.open = null; toast('Kept. It no longer counts as a problem'); renderSetList() }
  else if ((b = q('[data-slunkeep]'))) { SL.kept.delete(b.dataset.slunkeep); renderSetList() }
  else if (q('[data-slonly]')) { SL.only = !SL.only; renderSetList() }
  else if (q('[data-slfixall]')) fixAll()
  else if ((b = q('[data-slgo]'))) { SL.open = b.dataset.slgo; SL.only = false; renderSetList(); document.querySelector(`[data-jk="${CSS.escape(b.dataset.slgo)}"], .sl-fix`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }
  else if ((b = q('[data-slsort]'))) {
    const k = b.dataset.slsort, f = { n: null, t: x => x.t, ar: x => x.ar, key: x => x.cam || '', mood: x => -x.m.b, bpm: x => x.bpm || 0, e: x => x.e || 0, d: x => x.d, join: null }[k]
    if (!f) { SL.sort = null; renderSetList(); return }
    const o = ordered().slice().sort((p, q2) => { const a = f(p), c = f(q2); return typeof a === 'string' ? a.localeCompare(c) : a - c })
    SL.sort = k; freeze(o); toast(`Set sorted by ${b.textContent.toLowerCase()}`); render(false)
  }
})
render(false)
// Screenshot aid: ?mixset loads a set with real clashes and opens the first fix.
if (new URLSearchParams(location.search).has('mixset')) setTimeout(() => { S.set = [...LIB.filter(t => t.al === 'Vexillology').slice(0, 4), ...LIB.filter(t => t.bpm >= 170).slice(0, 3), ...LIB.filter(t => (t.e || 0) < 25).slice(0, 2)]; S.setOrder = 'mine'; SL.open = joinsOf(ordered()).find(j => j.issues.length)?.key; render(false) }, 350)
