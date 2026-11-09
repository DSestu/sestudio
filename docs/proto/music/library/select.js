// Multi-select on the tape and in the set lane: click, Ctrl/⌘-click, Shift-click, and a drag box.
// On the tape, dragging a selected track carries the whole selection (HTML5 drag) to the set.

const SEL = { anchor: null, skipClick: false }
const isMod = e => e.ctrlKey || e.metaKey

/** A drag box over `box` (position: relative), selecting the `.itemSel` elements it touches. */
function marquee(box, e, itemSel, base, apply, done) {
  const r0 = box.getBoundingClientRect(), x0 = e.clientX - r0.left + box.scrollLeft, y0 = e.clientY - r0.top + box.scrollTop
  const scroller = box.closest('.tape2') || box
  let m = null, hits = new Set()
  const move = ev => {
    const r = box.getBoundingClientRect(), x1 = ev.clientX - r.left + box.scrollLeft, y1 = ev.clientY - r.top + box.scrollTop
    if (!m && Math.hypot(x1 - x0, y1 - y0) < 6) return
    if (!m) { m = document.createElement('div'); m.className = 'marquee'; box.appendChild(m); try { box.setPointerCapture(ev.pointerId) } catch {} }
    // Near an edge of a scrolling tape, keep scrolling.
    const sr = scroller.getBoundingClientRect()
    if (ev.clientX > sr.right - 40) scroller.scrollLeft += 14; else if (ev.clientX < sr.left + 40) scroller.scrollLeft -= 14
    const L = Math.min(x0, x1), T = Math.min(y0, y1), W = Math.abs(x1 - x0), H = Math.abs(y1 - y0)
    Object.assign(m.style, { left: L + 'px', top: T + 'px', width: W + 'px', height: H + 'px' })
    const mr = m.getBoundingClientRect()
    hits = new Set()
    for (const el of box.querySelectorAll(itemSel)) { const b = el.getBoundingClientRect(); if (b.right > mr.left && b.left < mr.right && b.bottom > mr.top && b.top < mr.bottom) hits.add(el.dataset.id) }
    apply(new Set([...base, ...hits]))
  }
  const up = ev => { box.removeEventListener('pointermove', move); box.removeEventListener('pointerup', up); m?.remove(); done(!!m, new Set([...base, ...hits]), ev) }
  box.addEventListener('pointermove', move); box.addEventListener('pointerup', up)
}

// ---- tape -------------------------------------------------------------------------------------------
function tapeClick(e, id) {
  const t = byId(id); if (!t) return
  if (isMod(e)) { S.multi.has(id) ? S.multi.delete(id) : S.multi.add(id); SEL.anchor = id }
  else if (e.shiftKey && SEL.anchor) {
    const ids = laid.map(l => l.t.id), a = ids.indexOf(SEL.anchor), b = ids.indexOf(id)
    if (a >= 0 && b >= 0) for (const k of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) S.multi.add(k)
  } else { S.multi = new Set([id]); SEL.anchor = id }
  S.sel = t
  render(false)
}
$('inner').addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.pointerType === 'touch') return
  const el = e.target.closest('.trk')
  if (el && S.multi.has(el.dataset.id)) return // a selected track: native drag carries the selection
  marquee($('inner'), e, '.trk', isMod(e) || e.shiftKey ? S.multi : new Set(),
    sel => document.querySelectorAll('#inner .trk').forEach(x => x.classList.toggle('msel', sel.has(x.dataset.id))),
    (moved, sel, ev) => {
      SEL.skipClick = true
      if (moved) { S.multi = sel; render(false) }
      else if (el) tapeClick(ev, el.dataset.id)
      else if (!isMod(ev)) { S.multi = new Set(); render(false) }
    })
})
$('inner').addEventListener('click', e => {
  if (SEL.skipClick) { SEL.skipClick = false; return }
  const el = e.target.closest('.trk'); if (el) tapeClick(e, el.dataset.id)
}, true)

// ---- set lane -------------------------------------------------------------------------------------------
function laneClick(e, id) {
  const x = byId(id); if (!x) return
  if (isMod(e)) { D.sel.has(id) ? D.sel.delete(id) : D.sel.add(id); D.anchor = id }
  else if (e.shiftKey && D.anchor) {
    const ids = ordered().map(t => t.id), a = ids.indexOf(D.anchor), b = ids.indexOf(id)
    if (a >= 0 && b >= 0) for (const k of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) D.sel.add(k)
  } else { D.sel = new Set([id]); D.anchor = id }
  if (!x.online && !isMod(e) && !e.shiftKey) { S.sel = x; render(false); scrollToSel() } else renderTray()
}

// ---- selection actions, keyboard ---------------------------------------------------------------------------
document.addEventListener('click', e => {
  if (e.target.closest('[data-madd]')) { const ts = laid.map(l => l.t).filter(t => S.multi.has(t.id)); addGroupToSet(ts, null, "Selection"); render(false) }
  else if (e.target.closest('[data-mclr]')) { S.multi = new Set(); render(false) }
})
document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, select')) return
  if (e.key === 'Escape') { S.multi = new Set(); D.sel = new Set(); render(false) }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && D.sel.size) { e.preventDefault(); removeFromSet(ordered().filter(t => D.sel.has(t.id))) }
  else if (isMod(e) && e.key.toLowerCase() === 'a' && document.querySelector('#tape:hover')) { e.preventDefault(); S.multi = new Set(laid.map(l => l.t.id)); render(false) }
})
