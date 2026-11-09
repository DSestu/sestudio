// Set drawer variants for play2.html. A: bottom dock, B: side drawer, C: lane under the tape.
// Shared: drag to reorder, pins, drag in from the tape, and where an added track landed.

I.grip = '<circle cx="9" cy="6" r="1.4" fill="currentColor"/><circle cx="15" cy="6" r="1.4" fill="currentColor"/><circle cx="9" cy="12" r="1.4" fill="currentColor"/><circle cx="15" cy="12" r="1.4" fill="currentColor"/><circle cx="9" cy="18" r="1.4" fill="currentColor"/><circle cx="15" cy="18" r="1.4" fill="currentColor"/>'
I.pin = '<path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7"/>'

const byId = id => T.find(t => t.id === id) || (typeof ONLINE !== 'undefined' && ONLINE.get(id))
const jm = (a, b) => a.online || b.online ? 'oklch(55% .02 240)' : markOf(joinD(a, b))
const D = { v: new URLSearchParams(location.search).get('drawer') || window.DRAWER_DEFAULT || 'A', open: false, pins: new Set(), sel: new Set(), anchor: null, undo: null, landed: '', landedAt: 0, flash: null, inited: false }

/** The set in display order: yours, or best blend around the pinned tracks. */
function ordered() {
  if (!['blend', 'harmony'].includes(S.setOrder) || S.set.length < 3) return S.set.slice()
  const n = S.set.length, out = Array(n)
  S.set.forEach((t, i) => { if (D.pins.has(t.id)) out[i] = t })
  const free = S.set.filter(t => !D.pins.has(t.id))
  const ord = free.length > 1 ? (S.setOrder === 'harmony' ? harmonyOrder(free) : bestOrder(free, { shape: S.setShape })) : free
  let k = 0; for (let i = 0; i < n; i++) if (!out[i]) out[i] = ord[k++]
  return out
}
function addToSet(t, at) {
  if (S.set.includes(t)) return
  if (at == null) S.set.push(t)
  else { const o = ordered(); o.splice(at, 0, t); S.set = o; if (tv('autoPin', true)) D.pins.add(t.id) }
  const o = ordered(), i = o.indexOf(t)
  const nb = [o[i - 1], o[i + 1]].filter(Boolean).map(u => i > 0 && u === o[i - 1] ? joinD(u, t) : joinD(t, u))
  D.landed = t.online ? `${t.t} → #${i + 1} · analysing on add` : `${t.t} → #${i + 1}${nb.length ? ` · blends ${Math.round((1 - avg(nb)) * 100)}` : ''}${at != null ? ' · pinned there' : ''}`
  if (!tv('landedMsg', true)) D.landed = ''
  D.landedAt = Date.now(); D.flash = t.id
  setTimeout(() => { if (Date.now() - D.landedAt >= 3000) { D.landed = ''; renderTray() } }, 3100)
}
function addGroupToSet(ts, at, label) {
  const add = ts.filter(t => !S.set.includes(t))
  if (!add.length) { toast(`All of ${label} is already in your set`); return }
  if (at == null) S.set.push(...add)
  else { const o = ordered(); o.splice(at, 0, ...add); S.set = o; if (tv('autoPin', true)) add.forEach(t => D.pins.add(t.id)) }
  const o = ordered(), idx = add.map(t => o.indexOf(t) + 1).sort((a, b) => a - b)
  const block = idx.at(-1) - idx[0] === idx.length - 1
  D.landed = tv('landedMsg', true) ? `${label} · ${add.length} track${add.length > 1 ? 's' : ''} ${block ? `→ #${idx[0]}${idx.length > 1 ? '–' + idx.at(-1) : ''}${at != null && tv('autoPin', true) ? ' · pinned there' : ''}` : 'blended in'}${add.length < ts.length ? ` · ${ts.length - add.length} already in` : ''}` : ''
  D.landedAt = Date.now(); D.flash = add[0].id
  setTimeout(() => { if (Date.now() - D.landedAt >= 3000) { D.landed = ''; renderTray() } }, 3100)
}
function toggleSet(t) {
  const i = S.set.indexOf(t)
  if (i < 0) addToSet(t); else { S.set.splice(i, 1); D.pins.delete(t.id) }
  render(false)
}
function moveTo(from, to) {
  const o = ordered(); const [t] = o.splice(from, 1); o.splice(to > from ? to - 1 : to, 0, t)
  S.set = o; S.setOrder = 'mine'
  toast('Your order now. Best blend puts it back, keeping pins.')
}

// ---- pieces ----------------------------------------------------------------------------------
const pathOf = t => { const v = t.curve.length ? t.curve : [20, 20], n = v.length; return `M${v.map((e, k) => `${(k / (n - 1) * 100).toFixed(1)},${(50 - e / 100 * 48).toFixed(1)}`).join('L')}L${v.map((e, k) => `${(k / (n - 1) * 100).toFixed(1)},${(50 + e / 100 * 48).toFixed(1)}`).reverse().join('L')}Z` }
const leanOf = (a, b) => { const de = (b.e || 0) - (a.e || 0); return de > 6 ? 'Lift' : de < -6 ? 'Ease' : 'Hold' }
function controls(o) {
  const sc = scoreOf(o)
  return `<div class="dctl"><div class="seg"><button data-so="mine" class="${S.setOrder === 'mine' ? 'on' : ''}">Your order</button><button data-so="blend" class="${S.setOrder === 'blend' ? 'on' : ''}">Best blend</button></div>
    ${S.setOrder === 'blend' && typeof wChip === 'function' ? wChip('set') : ''}
    ${S.setOrder === 'blend' ? `<div class="seg">${['Hold', 'Lift', 'Ease', 'Arc'].map(k => `<button data-ss="${k}" class="${S.setShape === k ? 'on' : ''}">${k}</button>`).join('')}</div>` : ''}
    <button class="dtog ${tv('autoPin', true) ? 'on' : ''}" data-pintog title="Tracks dropped between two others stay pinned there">${icon('pin', 13)}Pin on drop</button>
    ${D.pins.size ? `<button class="dtog" data-unpinall>Unpin all · ${D.pins.size}</button>` : ''}
    ${D.sel.size ? `<span class="dselc"><b>${D.sel.size}</b> selected<button data-rmsel>${icon('close', 12)}Remove</button><button data-desel>Clear</button></span>` : ''}
    ${D.undo && Date.now() - D.undo.at < 8000 ? `<button class="dtog undo" data-undo>Undo remove · ${D.undo.n}</button>` : ''}
    <span class="sp"></span>${o.length > 1 ? `<span class="sc"><b class="tab">${sc.smooth}</b> blend · ${sc.rough} rough · ${clashCount(o)} clash${clashCount(o) === 1 ? '' : 'es'}${D.pins.size ? ` · ${D.pins.size} pinned` : ''}</span>` : ''}</div>`
}
function actions(compact) {
  return `<div class="dacts"><button class="btn pri" data-act="play">${icon('play', 12)}Play the set</button><button class="btn" data-act="queue">${compact ? 'Queue' : 'Add to queue'}</button><button class="btn" data-act="save">${icon('plus', 13)}${compact ? 'Save' : 'Save playlist'}</button>${compact ? '' : `<button class="btn" data-act="flow">${icon('flow', 13)}As a flow</button>`}<button class="btn ghost" data-act="clear">Clear</button></div>`
}
function shapeLane(o) {
  if (o.length < 2) return ''
  const W = 600, H = 40, n = o.length
  const act = o.map((t, i) => `${(i / (n - 1) * W).toFixed(1)},${(H - 4 - (t.e || 0) / 100 * (H - 8)).toFixed(1)}`)
  const eLo = Math.min(...o.map(t => t.e || 0)), eHi = Math.max(...o.map(t => t.e || 0))
  const want = S.setOrder === 'blend' ? Array.from({ length: 31 }, (_, k) => `${(k / 30 * W).toFixed(1)},${(H - 4 - (eLo + SHAPES[S.setShape](k / 30) * (eHi - eLo)) / 100 * (H - 8)).toFixed(1)}`) : null
  return `<div class="shape-lane"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${want ? `<path d="M${want.join('L')}" fill="none" stroke="var(--blue)" stroke-width="2" stroke-dasharray="5 5" vector-effect="non-scaling-stroke" opacity=".8"/>` : ''}<path d="M${act.join('L')}" fill="none" stroke="oklch(95% .01 240 / .8)" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg><span class="lbl">Energy${want ? ' · dashed: ' + S.setShape : ''}</span></div>`
}
function laneHtml(o) {
  if (!o.length) return `<div class="dropzone" data-drop="lane" style="min-height:110px">Drag tracks here from the tape, or press + on any track.<br>Drop between two tracks to pin it there.</div>`
  return `<div class="slane" data-drop="lane" data-axis="x">${o.map((t, i) => (i ? `<span class="j"><i style="background:${jm(o[i - 1], t)}"></i></span>` : '') +
    `<div class="it ${t.online ? 'pend' : ''} ${D.sel.has(t.id) ? 'dsel' : ''} ${D.pins.has(t.id) ? 'pinned' : ''} ${S.sel === t ? 'sel' : ''} ${D.flash === t.id ? 'flash' : ''}" data-i="${i}" data-id="${t.id}" style="--d:${t.d || 200}">${t.online ? `<img class="thumb" src="${t.thumb}" alt="">` : ''}<svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${pathOf(t)}" fill="${trackColor(t)}" fill-opacity=".85"/></svg><span class="nm">${esc(t.t)}<i>${t.m.word} · ${t.bpm}</i></span>
      <span class="tools"><button class="pin" data-pin="${t.id}" title="Pin here">${icon('pin', 12)}</button><button data-rm="${t.id}" title="Remove">${icon('close', 11)}</button></span></div>`).join('')}</div>`
}
function listHtml(o, maxH) {
  if (!o.length) return `<div class="dropzone" data-drop="list" style="min-height:140px">Your set is empty.<br>Press + on any track, or drag one here from the tape.</div>`
  return `<div class="slist" data-drop="list" data-axis="y" ${maxH ? `style="max-height:${maxH}"` : ''}>${o.map((t, i) => (i ? `<div class="jr"><i style="background:${jm(o[i - 1], t)}"></i>${leanOf(o[i - 1], t)} · ${o[i - 1].bpm === t.bpm ? 'same tempo' : `${o[i - 1].bpm}→${t.bpm}`} · ${Math.round((1 - joinD(o[i - 1], t)) * 100)}</div>` : '') +
    `<div class="it ${t.online ? 'pend' : ''} ${D.sel.has(t.id) ? 'dsel' : ''} ${D.pins.has(t.id) ? 'pinned' : ''} ${S.sel === t ? 'sel' : ''} ${D.flash === t.id ? 'flash' : ''}" data-i="${i}" data-id="${t.id}"><span class="grip" title="Drag to reorder">${icon('grip', 16)}</span><span class="n tab">${i + 1}</span>${sigil(t, 44, 28, { r: 7 })}<span class="t"><b>${esc(t.t)}</b><small><i class="dot" style="background:${t.m.color}"></i> ${t.m.word} · ${t.bpm} · ${fmtTime(t.d)}</small></span><button class="pin" data-pin="${t.id}" title="${D.pins.has(t.id) ? 'Unpin' : 'Pin here'}">${icon('pin', 15)}</button><button data-rm="${t.id}" title="Remove">${icon('close', 13)}</button></div>`).join('')}</div>`
}
const meta = () => `${S.set.length} track${S.set.length === 1 ? '' : 's'}${S.set.length ? ' · ' + fmtDur(S.set.reduce((a, t) => a + t.d, 0)) : ''}`

// ---- variants ----------------------------------------------------------------------------------
function initDrawer() {
  if (D.inited) return; D.inited = true
  if (new URLSearchParams(location.search).has('demo')) { S.set = LIB.filter(t => t.m.word === 'Dark' && Math.abs(t.bpm - 128) <= 3).slice(0, 9); D.pins.add(S.set[4].id); D.open = true; D.landed = S.set[8].t + ' → #6 · blends 91'; D.landedAt = Date.now() + 1e9 }
  const sw = `<div class="seg dv" id="dv">${[['A', 'Dock'], ['B', 'Side'], ['C', 'Lane']].map(([k, l]) => `<button data-dv="${k}" class="${D.v === k ? 'on' : ''}">${k} · ${l}</button>`).join('')}</div>`
  document.querySelector('.top-row').insertAdjacentHTML('beforeend', `<span class="desk" style="display:contents">${window.DRAWER_LOCK ? '' : sw}</span><span id="setbtnwrap" style="display:contents"></span>`)
  if (!window.DRAWER_LOCK) document.getElementById('pchips').insertAdjacentHTML('afterbegin', sw.replace('id="dv"', 'id="dv2"'))
  document.body.insertAdjacentHTML('beforeend', `<div id="dockA" class="dockA" hidden></div><aside id="sideB" class="sideB"></aside><span id="fabB"></span>`)
  document.getElementById('tape').insertAdjacentHTML('afterend', `<section id="laneC" class="laneC" hidden></section>`)
  document.addEventListener('click', e => {
    const v = e.target.closest('[data-dv]'); if (v) { D.v = v.dataset.dv; D.open = false; history.replaceState(null, '', '?drawer=' + D.v); document.querySelectorAll('[data-dv]').forEach(b => b.classList.toggle('on', b.dataset.dv === D.v)); renderTray(); return }
    const so = e.target.closest('[data-so]'); if (so) { S.setOrder = so.dataset.so; renderTray(); return }
    const ss = e.target.closest('[data-ss]'); if (ss) { S.setShape = ss.dataset.ss; S.setOrder = 'blend'; renderTray(); return }
    const pn = e.target.closest('[data-pin]'); if (pn) { const id = pn.dataset.pin; if (D.pins.has(id)) D.pins.delete(id); else { if (S.setOrder !== 'mine') S.set = ordered(); D.pins.add(id) } renderTray(); return }
    const rm = e.target.closest('[data-rm]'); if (rm) { toggleSet(byId(rm.dataset.rm)); return }
    const ac = e.target.closest('[data-act]'); if (ac) { const o = ordered(); ({ play: () => { if (o.length) { play(o[0]); toast(`Playing your set: ${o.length} tracks`) } }, queue: () => toast(`${o.length} tracks slotted into the queue where each blends best`), save: () => askName(ac), flow: () => toast(`A flow from these ${o.length} tracks`), clear: () => { S.set = []; D.pins.clear(); render(false) } })[ac.dataset.act](); return }
    if (e.target.closest('[data-pintog]')) { window.TUNE = window.TUNE || {}; TUNE.autoPin = !tv('autoPin', true); if (typeof save === 'function') { save(); renderTune() } toast(TUNE.autoPin ? 'Tracks you drop between two others stay pinned there' : 'Tracks you drop get blended in, not pinned'); renderTray(); return }
    if (e.target.closest('[data-unpinall]')) { const n = D.pins.size; D.pins.clear(); toast(`${n} unpinned. Best blend can move them now`); renderTray(); return }
    if (e.target.closest('[data-rmsel]')) { removeFromSet(ordered().filter(t => D.sel.has(t.id))); return }
    if (e.target.closest('[data-desel]')) { D.sel = new Set(); renderTray(); return }
    if (e.target.closest('[data-undo]')) { S.set = D.undo.set; D.pins = D.undo.pins; S.setOrder = D.undo.order; D.undo = null; render(false); return }
    const tg = e.target.closest('[data-toggle]'); if (tg) { D.open = !D.open; renderTray(); return }
  })
  // Drag a track from the tape into the set (desktop).
  document.addEventListener('dragstart', e => {
    const el = e.target.closest?.('[draggable="true"]'); if (!el) return
    const multi = el.classList.contains('trk') && el.classList.contains('msel') && S.multi && S.multi.size > 1 ? laid.map(l => l.t).filter(x => S.multi.has(x.id)) : null
    const gk = el.dataset.gk, ts = gk ? tracksOfKey(gk) : multi, t = gk || multi ? null : byId(el.dataset.id)
    if (!gk && !t && !multi) return
    e.dataTransfer.setData('text/plain', multi ? 'multi:' + multi.map(x => x.id).join(',') : gk ? 'group:' + gk : t.id); e.dataTransfer.effectAllowed = 'copy'
    const chip = document.createElement('div'); chip.className = 'dragchip'
    chip.innerHTML = gk ? `${icon('plus', 13)}<b>${esc(gk.split('|').at(-1).replace(/^[a-z]{2}:/, ''))}</b><span>${ts.length} tracks</span>` : multi ? `${icon('plus', 13)}<b>${multi.length} tracks</b><span>selection</span>` : `${icon('plus', 13)}<b>${esc(t.t)}</b>`
    document.body.appendChild(chip); e.dataTransfer.setDragImage(chip, 14, 16); setTimeout(() => chip.remove(), 0)
  })
  document.addEventListener('dragover', e => { const z = e.target.closest('[data-drop]'); if (!z) return; e.preventDefault(); z.classList.add('over'); const ax = z.dataset.axis; if (ax) mark(z, slotAt(z, ax, ax === 'y' ? e.clientY : e.clientX), ax) })
  document.addEventListener('dragleave', e => { const z = e.target.closest('[data-drop]'); if (z && !z.contains(e.relatedTarget)) { z.classList.remove('over'); unmark(z) } })
  document.addEventListener('drop', e => {
    const z = e.target.closest('[data-drop]'); if (!z) return; e.preventDefault()
    const data = e.dataTransfer.getData('text/plain'), ax = z.dataset.axis
    z.classList.remove('over')
    if (data.startsWith('multi:')) { const ts = data.slice(6).split(',').map(byId).filter(Boolean); addGroupToSet(ts, ax ? slotAt(z, ax, ax === 'y' ? e.clientY : e.clientX) : null, "Selection"); unmark(z); render(false); return }
    if (data.startsWith('group:')) { const gk = data.slice(6); addGroupToSet(tracksOfKey(gk), ax ? slotAt(z, ax, ax === 'y' ? e.clientY : e.clientX) : null, gk.split('|').at(-1).replace(/^[a-z]{2}:/, '')); unmark(z); render(false); return }
    const t = byId(data); if (!t) return
    if (S.set.includes(t)) { toast('Already in your set'); unmark(z); return }
    addToSet(t, ax ? slotAt(z, ax, ax === 'y' ? e.clientY : e.clientX) : null); render(false)
  })
}
function items(z) { return [...z.querySelectorAll(':scope > .it')] }
function slotAt(z, ax, p, skip) {
  const its = items(z)
  for (const o of its) { if (skip && (Array.isArray(skip) ? skip.includes(o) : o === skip)) continue; const r = o.getBoundingClientRect(); if (p < (ax === 'y' ? r.top + r.height / 2 : r.left + r.width / 2)) return +o.dataset.i }
  return its.length
}
function mark(z, i, ax) {
  let m = z.querySelector(':scope > .marker'); if (!m) { m = document.createElement('span'); m.className = 'marker'; z.appendChild(m) }
  const its = items(z), zr = z.getBoundingClientRect(), ref = its[Math.min(i, its.length - 1)]
  if (!ref) return
  const r = ref.getBoundingClientRect(), after = i >= its.length
  if (ax === 'y') Object.assign(m.style, { left: '8px', right: '8px', height: '3px', width: 'auto', top: ((after ? r.bottom : r.top) - zr.top + z.scrollTop - 2) + 'px' })
  else Object.assign(m.style, { top: '4px', bottom: '4px', width: '3px', height: 'auto', left: ((after ? r.right : r.left) - zr.left + z.scrollLeft - 2) + 'px' })
}
function unmark(z) { z.querySelector(':scope > .marker')?.remove() }
/** Inside the set: click to select, drag to move the track or the whole selection, drag it off the lane to remove. */
const _laneClick = (ev, id) => typeof laneClick === 'function' ? laneClick(ev, id) : (S.sel = byId(id), render(false))
function sortable(z) {
  if (!z || !z.dataset.axis) return
  const ax = z.dataset.axis
  z.onpointerdown = e => {
    if (e.button !== 0 || e.target.closest('button')) return
    const it = e.target.closest('.it')
    if (!it) {
      if (e.pointerType === 'touch' || typeof marquee !== 'function') return
      marquee(z, e, '.it', isMod(e) || e.shiftKey ? D.sel : new Set(), sel => z.querySelectorAll('.it').forEach(x => x.classList.toggle('dsel', sel.has(x.dataset.id))), (moved, sel, ev) => { if (moved) D.sel = sel; else if (!isMod(ev)) D.sel = new Set(); renderTray() })
      return
    }
    if (ax === 'y' && !e.target.closest('.grip')) { it.onpointerup = ev => { it.onpointerup = null; _laneClick(ev, it.dataset.id) }; return }
    const id = it.dataset.id, o = ordered(), moving = D.sel.has(id) ? o.filter(t => D.sel.has(t.id)) : [byId(id)]
    const els = moving.map(t => z.querySelector(`.it[data-id="${t.id}"]`)).filter(Boolean)
    const zr = z.getBoundingClientRect(); let moved = false, to = +it.dataset.i, removing = false
    try { it.setPointerCapture(e.pointerId) } catch {}
    it.onpointermove = ev => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 6) return
      moved = true
      removing = ax === 'x' ? (ev.clientY < zr.top - 36 || ev.clientY > zr.bottom + 36) : (ev.clientX < zr.left - 50 || ev.clientX > zr.right + 50)
      els.forEach(el => { el.classList.add('dragging'); el.classList.toggle('removing', removing); el.style.transform = `translate(${ev.clientX - e.clientX}px, ${ev.clientY - e.clientY}px)` })
      rmHint(removing ? moving.length : 0, ev)
      if (removing) { unmark(z); return }
      to = slotAt(z, ax, ax === 'y' ? ev.clientY : ev.clientX, els); mark(z, to, ax)
    }
    it.onpointerup = ev => {
      it.onpointermove = it.onpointerup = null; unmark(z); rmHint(0)
      if (!moved) { _laneClick(ev, id); return }
      if (removing) { removeFromSet(moving); return }
      moveBlock(moving, to); renderTray()
    }
  }
}
function rmHint(n, ev) {
  let h = document.getElementById('rmhint'); if (!n) { h?.remove(); return }
  if (!h) { h = document.createElement('div'); h.id = 'rmhint'; document.body.appendChild(h) }
  h.innerHTML = `${icon('close', 13)}Release to remove ${n} track${n > 1 ? 's' : ''}`; h.style.left = ev.clientX + 14 + 'px'; h.style.top = ev.clientY + 14 + 'px'
}
function moveBlock(moving, to) {
  const o = ordered(), ids = new Set(moving.map(t => t.id))
  let target = o[to]; while (target && ids.has(target.id)) target = o[o.indexOf(target) + 1]
  const rest = o.filter(t => !ids.has(t.id)); rest.splice(target ? rest.indexOf(target) : rest.length, 0, ...moving)
  const changed = rest.some((t, i) => t !== o[i]); S.set = rest
  if (changed && S.setOrder !== 'mine') { const was = S.setOrder === 'harmony' ? 'Harmony' : 'Best blend'; S.setOrder = 'mine'; toast(`Your order now. ${was} puts it back, keeping pins.`) }
}
function removeFromSet(ts) {
  if (!ts.length) return
  D.undo = { set: S.set.slice(), pins: new Set(D.pins), order: S.setOrder, n: ts.length, at: Date.now() }
  const ids = new Set(ts.map(t => t.id)); S.set = S.set.filter(t => !ids.has(t.id)); ids.forEach(i => { D.pins.delete(i); D.sel.delete(i) })
  toast(`Removed ${ts.length} track${ts.length > 1 ? 's' : ''}. Undo is in the set bar`); setTimeout(() => renderTray(), 8100); render(false)
}
/** Save asks for a name first, with a suggestion you can type over. */
function askName(anchor) {
  document.getElementById('namepop')?.remove()
  const o = ordered(); if (!o.length) { toast('Your set is empty'); return }
  const m = most(o.map(t => t.m.word)), b = Math.round(avg(o.map(t => t.bpm).filter(Boolean)))
  const sug = S.source && S.source.kind !== 'Playlist' ? `${S.source.name} mix` : `${m} ${b} set`
  const el = document.createElement('form'); el.id = 'namepop'
  el.innerHTML = `<label>Name this playlist<input name="n" value="${esc(sug)}" maxlength="80" autocomplete="off"></label><p class="np-meta">${o.length} tracks · ${fmtDur(o.reduce((a, t) => a + t.d, 0))} · in this order</p><p class="np-warn" hidden></p><div class="np-b"><button type="button" class="btn ghost" data-npc>Cancel</button><button class="btn pri">Save</button></div>`
  document.body.appendChild(el)
  const r = anchor.getBoundingClientRect(); el.style.left = Math.max(8, Math.min(innerWidth - 300, r.left)) + 'px'; el.style.top = Math.max(8, r.top - el.offsetHeight - 8) + 'px'
  const inp = el.querySelector('input'), warn = el.querySelector('.np-warn'); inp.focus(); inp.select()
  const check = () => { const v = inp.value.trim(), dup = PLAYLISTS.some(p => p.name.toLowerCase() === v.toLowerCase()); warn.hidden = !dup && !!v; warn.textContent = !v ? 'Give it a name' : 'A list with this name exists; this saves a second one'; return v }
  inp.addEventListener('input', check)
  el.addEventListener('submit', ev => { ev.preventDefault(); const v = check(); if (!v) return; PLAYLISTS.push(summarise(v, o, 'Playlist')); el.remove(); toast(`Saved “${v}” · ${o.length} tracks · it's in Lists`); render(false) })
  el.querySelector('[data-npc]').onclick = () => el.remove()
  el.addEventListener('keydown', ev => { if (ev.key === 'Escape') el.remove() })
  setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!el.contains(ev.target)) { el.remove(); document.removeEventListener('pointerdown', off) } }), 0)
}

function renderTray() {
  initDrawer()
  const o = ordered(), mob = phone()
  const A = document.getElementById('dockA'), B = document.getElementById('sideB'), C = document.getElementById('laneC'), btn = document.getElementById('setbtnwrap'), fab = document.getElementById('fabB')
  A.hidden = D.v !== 'A'; C.hidden = D.v !== 'C'; B.style.display = D.v === 'B' ? '' : 'none'
  document.body.classList.toggle('dA', D.v === 'A'); document.body.classList.toggle('open', D.v === 'A' && D.open)
  btn.innerHTML = ''; fab.innerHTML = ''
  const sub = D.landed ? `<span class="landed">${esc(D.landed)}</span>` : `${meta()}${o.length > 1 ? ` · ${scoreOf(o).smooth} blend` : ''}`
  if (D.v === 'A') {
    A.innerHTML = `<div class="peek" data-drop="peek"><span class="who" data-toggle><b>Your set</b><small>${sub}</small></span><span class="strip">${o.length > 1 ? joinStrip(o, 800, 36, { gap: 4 }) : `<span style="color:var(--dim);font-size:12px">Empty. Press + on a track or drag one here.</span>`}</span>
      ${o.length ? `<button class="btn pri" data-act="play">${icon('play', 12)}Play</button>` : ''}<button class="chev" data-toggle title="${D.open ? 'Close' : 'Open'}">${icon(D.open ? 'down' : 'up', 18)}</button></div>
      ${D.open ? `${controls(o)}${mob ? listHtml(o, '34vh') : shapeLane(o) + laneHtml(o)}${actions(mob)}` : ''}`
    sortable(A.querySelector('[data-axis]'))
  }
  if (D.v === 'B') {
    const b = `<button class="setbtn ${mob ? 'fab' : ''}" data-toggle>${o.length > 1 ? `<span class="mstrip">${joinStrip(o, 200, 24, { gap: 2, diamonds: false })}</span>` : icon('plus', 16)}Set · ${S.set.length}${D.landed && !D.open ? `<span class="landed">${esc(D.landed)}</span>` : ''}</button>`
    if (mob) fab.innerHTML = b; else btn.innerHTML = `<span data-drop="btn" style="display:contents">${b}</span>`
    B.classList.toggle('open', D.open)
    B.innerHTML = `<div class="hd"><h2>Your set</h2><small>${D.landed ? `<span class="landed">${esc(D.landed)}</span>` : meta()}</small><button data-toggle title="Close">${icon('close', 16)}</button></div>${controls(o)}${shapeLane(o)}${listHtml(o)}${actions(false)}`
    sortable(B.querySelector('[data-axis]'))
  }
  if (D.v === 'C') {
    C.innerHTML = `<div class="hd"><h2>Your set</h2><small>${sub}</small><span style="flex:1"></span>${o.length && !mob ? actions(true) : ''}</div>${o.length ? controls(o) : ''}${mob && o.length ? '' : shapeLane(o)}${laneHtml(o)}${o.length && mob ? actions(true) : ''}`
    sortable(C.querySelector('[data-axis]'))
  }
  D.flash = null
}
