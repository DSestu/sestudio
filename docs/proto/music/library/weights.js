// "Blend by": the weights of Best blend (harmony, mood, energy, genre) on a radar, plus the harmony
// moves inside it. Opens as an accordion under the row it was opened from, pushing the column down.

const WS = { where: null, open: false, harmOpen: localStorage.getItem('sestudio-harmopen') === '1', el: null }
const AX = Object.keys(AXES)
const saveW = () => { localStorage.setItem('sestudio-blendw', JSON.stringify(BW)); localStorage.setItem('sestudio-harmw', JSON.stringify(HW)); HCACHE.clear() }
const lead = () => { const w = blendShares(), [k, v] = Object.entries(w).sort((a, b) => b[1] - a[1])[0]; return v > .34 ? `${AXES[k][0]} first` : 'Balanced' }
const miniBars = () => { const w = blendShares(); return `<span class="wbars">${AX.map(k => `<i style="height:${Math.max(3, w[k] * 40)}px;background:${AXES[k][1]}"></i>`).join('')}</span>` }
const placeMode = () => tv('blendPlace', 'sticky')
function wChip(where) { const on = WS.open && (WS.where === where || placeMode() === 'sticky'); return `<button class="wchip ${on ? 'on' : ''}" data-wacc="${where}" aria-expanded="${on}" title="What Best blend cares about">${miniBars()}<span>Blend by</span><b>${lead()}</b>${icon(on ? 'up' : 'down', 13)}</button>` }

const PRESETS_W = [
  ['Balanced', { harmony: .7, mood: .7, energy: .7, genre: .7 }],
  ['Keys first', { harmony: 1, mood: .4, energy: .35, genre: .2 }],
  ['Keys only', { harmony: 1, mood: .05, energy: .05, genre: .05 }],
  ['DJ classic', { harmony: 1, mood: .3, energy: .9, genre: .2 }],
  ['Energy flow', { harmony: .4, mood: .3, energy: 1, genre: .3 }],
  ['Energy only', { harmony: .05, mood: .05, energy: 1, genre: .05 }],
  ['Mood first', { harmony: .45, mood: 1, energy: .4, genre: .3 }],
  ['Radio', { harmony: .4, mood: .9, energy: .4, genre: .9 }],
  ['Stay in genre', { harmony: .5, mood: .3, energy: .45, genre: 1 }],
  ['Cross genres', { harmony: .8, mood: .6, energy: .7, genre: .05 }],
]
const PRESETS_H = [
  ['Default', HW_DEF],
  ['Same key only', { same: 1, relative: .6, next: .3, mode: .1, lift: .05, drop: 0, clash: 0 }],
  ['Strict keys', { same: 1, relative: .9, next: .75, mode: .4, lift: .3, drop: .2, clash: 0 }],
  ['Circle of fifths', { same: .8, relative: .9, next: 1, mode: .3, lift: .2, drop: .1, clash: 0 }],
  ['Modal', { same: 1, relative: .8, next: .6, mode: .95, lift: .3, drop: .2, clash: 0 }],
  ['DJ friendly', { same: 1, relative: .9, next: .9, mode: .65, lift: .85, drop: .6, clash: 0 }],
  ['Lift the set', { same: .9, relative: .8, next: .8, mode: .5, lift: 1, drop: .1, clash: 0 }],
  ['Bring it down', { same: .9, relative: .8, next: .8, mode: .5, lift: .1, drop: 1, clash: 0 }],
  ['Anything goes', { same: 1, relative: .9, next: .85, mode: .75, lift: .75, drop: .7, clash: .45 }],
]
const sameW = v => { const s = Object.values(v).reduce((a, b) => a + b, 0), w = blendShares(); return AX.every(k => Math.abs(w[k] - v[k] / s) < .02) }
const sameH = v => Object.keys(v).every(k => Math.abs((HW[k] ?? 0) - v[k]) < .02)
const harmName = () => PRESETS_H.find(([, v]) => sameH(v))?.[0] || 'Custom'

// ---- radar ------------------------------------------------------------------------------------------------
const RAX = { harmony: [0, -1], energy: [1, 0], genre: [0, 1], mood: [-1, 0] }
function radarSvg() {
  const pt = k => [100 + RAX[k][0] * 78 * BW[k], 100 + RAX[k][1] * 78 * BW[k]]
  return `<svg viewBox="-40 -12 280 224" class="wradar">
    ${[.25, .5, .75, 1].map(r => `<path d="M100,${100 - 78 * r} ${100 + 78 * r},100 100,${100 + 78 * r} ${100 - 78 * r},100Z" fill="none" stroke="oklch(45% .03 240 / ${r === 1 ? .6 : .25})"/>`).join('')}
    ${AX.map(k => `<line x1="100" y1="100" x2="${100 + RAX[k][0] * 78}" y2="${100 + RAX[k][1] * 78}" stroke="oklch(45% .03 240 / .4)"/>`).join('')}
    <path d="M${AX.map(k => pt(k).join(',')).join(' ')}Z" fill="oklch(72% .16 230 / .18)" stroke="oklch(72% .16 230 / .8)" stroke-width="1.5"/>
    ${AX.map(k => { const [x, y] = pt(k); return `<circle data-rk="${k}" cx="${x}" cy="${y}" r="8.5" fill="${AXES[k][1]}" stroke="oklch(18% .03 240)" stroke-width="2.5"/>` }).join('')}
    ${AX.map(k => { const x = 100 + RAX[k][0] * 92, y = 100 + RAX[k][1] * 94 + 4; return `<text x="${x}" y="${y}" text-anchor="${RAX[k][0] < 0 ? 'end' : RAX[k][0] > 0 ? 'start' : 'middle'}" font-size="11.5" font-weight="600" fill="${AXES[k][1]}">${AXES[k][0]}</text>` }).join('')}
  </svg>`
}
const readout = () => { const w = blendShares(); return AX.map(k => `<span style="--c:${AXES[k][1]}"><i></i>${AXES[k][0]} <b class="tab">${Math.round(w[k] * 100)}%</b></span>`).join('') }
function effectHtml() {
  const o = typeof ordered === 'function' && S.set.length > 1 ? ordered() : null
  if (!o) return `Add tracks to your set to see what this changes.`
  const sc = scoreOf(o), gen = o.slice(1).filter((t, i) => genreD(o[i], t) === 1).length, k = {}
  o.slice(1).forEach((t, i) => { const x = harmKind(o[i], t)?.kind; if (x) k[x] = (k[x] || 0) + 1 })
  return `Your set: <b class="tab">${sc.smooth}</b> blend · <b class="tab">${k.clash || 0}</b> clash${k.clash === 1 ? '' : 'es'} · <b class="tab">${(k.lift || 0) + (k.drop || 0)}</b> lift/drop · <b class="tab">${gen}</b> genre change${gen === 1 ? '' : 's'}`
}
function movesRows() {
  const o = S.set.length > 1 && typeof ordered === 'function' ? ordered() : [], cnt = {}
  o.slice(1).forEach((t, i) => { const k = harmKind(o[i], t)?.kind; if (k) cnt[k] = (cnt[k] || 0) + 1 })
  const pic = k => {
    const A = [0, 2, 4, 5, 7, 9, 11], shift = { same: 0, relative: 0, next: 7, mode: 0, lift: 2, drop: -2, clash: 6 }[k]
    const B = k === 'mode' ? [0, 2, 3, 5, 7, 9, 10] : k === 'relative' ? A : A.map(n => (n + shift + 12) % 12)
    const cell = (s, other) => Array.from({ length: 12 }, (_, i) => `<i class="${s.includes(i) ? (other.includes(i) ? 'sh' : 'on') : ''}"></i>`).join('')
    return `<span class="wpic"><span>${cell(A, B)}</span><span>${cell(B, A)}</span></span>`
  }
  return Object.entries(MOVES).map(([k, [l, d]]) => `<label class="wmv ${k === 'lift' || k === 'drop' ? 'tr' : k === 'clash' ? 'cl' : ''}">${pic(k)}<span class="wmv-t"><b>${l}</b><small>${d}</small></span>
    <input type="range" min="0" max="100" value="${Math.round(HW[k] * 100)}" data-hw="${k}"><em class="tab">${Math.round(HW[k] * 100)}</em><span class="wcnt tab" title="Joins like this in your set">${cnt[k] ? `${cnt[k]}×` : ''}</span></label>`).join('')
}
function accHtml() {
  return `<div class="wacc-in"><div class="wacc-body">
    <div class="wa-main">
      <div class="wctl" id="wctl">${radarSvg()}</div>
      <div class="wa-side">
        <p class="wa-h"><b>Blend by</b> what Best blend cares about between two tracks</p>
        <div class="wread" id="wread">${readout()}</div>
        <p class="whelp">Drag a dot out to make that axis count more, in to make it count less.</p>
        <div class="wpre" id="wpreW">${PRESETS_W.map(([n, v]) => `<button data-wpre="${n}" class="${sameW(v) ? 'on' : ''}">${n}</button>`).join('')}</div>
      </div>
    </div>
    <section class="wh ${WS.harmOpen ? 'open' : ''}">
      <button class="wh-h" data-wharm aria-expanded="${WS.harmOpen}">${icon('right', 13, 2.4)}<b>Harmony moves</b><span class="wh-cur">${harmName()}</span><small>how welcome each key move is</small></button>
      <div class="wh-grid"><div class="wh-in">
        <div class="wpre" id="wpreH">${PRESETS_H.map(([n, v]) => `<button data-hpre="${n}" class="${sameH(v) ? 'on' : ''}">${n}</button>`).join('')}</div>
        <div class="wmoves" id="wmoves">${movesRows()}</div>
        <p class="whelp">Lift and drop are transpositions: same mode, moved up or down. 0 means avoid, 100 means as good as the same key.</p>
      </div></div>
    </section>
    <div class="wa-foot"><p class="weff" id="weff">${effectHtml()}</p><span class="wfoot">Tempo is kept close on its own.</span><button class="btn" data-wclose>Done</button></div>
  </div></div>`
}

// ---- accordion: open under its row, persistent element, re-mounted after every render ----------------------
/** Three placements to compare (Tune › Blend): a sticky bar pinned to the top of the centre column,
 *  under the row whose chip opened it, or at the top of the column. */
const centre = () => document.querySelector('main .layout > section')
const anchorRow = where => where === 'tape' ? document.getElementById('bar') : document.querySelector('#laneC .dctl')
function effShort() {
  const o = typeof ordered === 'function' && S.set.length > 1 ? ordered() : null
  if (!o) return 'your set is empty'
  const c = clashCount(o); return `set ${scoreOf(o).smooth} blend · ${c} clash${c === 1 ? '' : 'es'}`
}
function mountStrip() {
  const c = centre(); if (!c) return
  let st = document.getElementById('wstrip')
  const want = placeMode() === 'sticky' && (S.setOrder === 'blend' || S.order === 'blend')
  if (!want) { st?.remove(); return }
  if (!st) { st = document.createElement('div'); st.id = 'wstrip'; st.className = 'wstrip'; st.innerHTML = '<button class="wstrip-h" data-wacc="strip"></button>' }
  st.classList.toggle('open', WS.open)
  st.querySelector('.wstrip-h').innerHTML = `${miniBars()}<span>Blend by</span><b>${lead()}</b><span class="wstrip-cur">· Harmony: ${harmName()}</span><span class="wstrip-eff">${effShort()}</span>${icon(WS.open ? 'up' : 'down', 14)}`
  if (c.firstElementChild !== st) c.prepend(st)
}
function mountAcc() {
  mountStrip()
  if (!WS.el) return
  const mode = placeMode(), c = centre()
  if (mode === 'sticky') { const st = document.getElementById('wstrip'); if (st && st.lastElementChild !== WS.el) st.appendChild(WS.el); else if (!st) c?.prepend(WS.el) }
  else if (mode === 'top') { if (c && c.firstElementChild !== WS.el) c.prepend(WS.el) }
  else { const row = anchorRow(WS.where); if (row && row.nextElementSibling !== WS.el) row.after(WS.el) }
}
function openAcc(where) {
  if (WS.open && (WS.where === where || placeMode() === 'sticky')) return closeAcc()
  if (WS.el) WS.el.remove()
  WS.where = where; WS.open = true
  WS.el = document.createElement('div'); WS.el.className = 'wacc'; WS.el.innerHTML = accHtml()
  render(false); mountAcc(); bindCtl()
  if (placeMode() === 'top') centre()?.scrollTo({ top: 0, behavior: 'smooth' })
  void WS.el.offsetHeight; WS.el.classList.add('open')
}
function closeAcc() {
  if (!WS.el) return
  const el = WS.el; WS.open = false; el.classList.remove('open')
  const gone = () => { if (!el.classList.contains('open')) { el.remove(); if (WS.el === el) WS.el = null } }
  el.addEventListener('transitionend', gone, { once: true }); setTimeout(gone, 450)
  render(false)
}
/** Live parts only (during a drag nothing else re-renders, so the pointer stays captured). */
function refreshLive() {
  if (!WS.el) return
  const q = id => WS.el.querySelector('#' + id)
  q('wread').innerHTML = readout(); q('weff').innerHTML = effectHtml()
  q('wpreW').querySelectorAll('[data-wpre]').forEach(b => b.classList.toggle('on', sameW(PRESETS_W.find(p => p[0] === b.dataset.wpre)[1])))
  q('wpreH').querySelectorAll('[data-hpre]').forEach(b => b.classList.toggle('on', sameH(PRESETS_H.find(p => p[0] === b.dataset.hpre)[1])))
  WS.el.querySelector('.wh-cur').textContent = harmName()
  document.querySelectorAll('[data-wacc]').forEach(c => { const b = c.querySelector('b'); if (b) b.textContent = lead(); c.querySelector('.wbars')?.replaceWith(Object.assign(document.createElement('span'), { innerHTML: miniBars() }).firstChild) })
  const se = document.querySelector('.wstrip-eff'); if (se) se.textContent = effShort()
  const sc = document.querySelector('.wstrip-cur'); if (sc) sc.textContent = '· Harmony: ' + harmName()
}
function commit() { saveW(); render(false); mountAcc(); refreshLive(); const m = WS.el?.querySelector('#wmoves'); if (m && !m.contains(document.activeElement)) m.innerHTML = movesRows() }
function bindCtl() {
  const c = WS.el?.querySelector('#wctl'); if (!c) return
  c.onpointerdown = e => {
    const svg = c.querySelector('svg'), vb = svg.viewBox.baseVal
    const pos = ev => { const r = c.querySelector('svg').getBoundingClientRect(); return [vb.x + (ev.clientX - r.left) / r.width * vb.width - 100, vb.y + (ev.clientY - r.top) / r.height * vb.height - 100] }
    let rk = e.target.closest('[data-rk]')?.dataset.rk
    if (!rk) { const [x, y] = pos(e); rk = AX.slice().sort((a, b) => (RAX[b][0] * x + RAX[b][1] * y) - (RAX[a][0] * x + RAX[a][1] * y))[0] }
    c.setPointerCapture(e.pointerId)
    const move = ev => { const [x, y] = pos(ev); BW[rk] = Math.max(.03, Math.min(1, (x * RAX[rk][0] + y * RAX[rk][1]) / 78)); c.innerHTML = radarSvg(); HCACHE.clear(); refreshLive() }
    const up = () => { c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); commit() }
    c.addEventListener('pointermove', move); c.addEventListener('pointerup', up); move(e)
  }
}
const _rb = renderBar
renderBar = function (ts) { _rb(ts); mountAcc() }
const _rt = renderTray
renderTray = function () { _rt(); mountAcc() }
document.addEventListener('click', e => {
  const q = s => e.target.closest(s); let b
  if ((b = q('[data-wacc]'))) { openAcc(b.dataset.wacc); return }
  if (q('[data-wclose]')) { closeAcc(); return }
  if ((b = q('[data-wpre]'))) { Object.assign(BW, PRESETS_W.find(p => p[0] === b.dataset.wpre)[1]); WS.el.querySelector('#wctl').innerHTML = radarSvg(); commit(); return }
  if ((b = q('[data-hpre]'))) { Object.assign(HW, PRESETS_H.find(p => p[0] === b.dataset.hpre)[1]); WS.el.querySelector('#wmoves').innerHTML = movesRows(); commit(); return }
  if (q('[data-wharm]')) { WS.harmOpen = !WS.harmOpen; localStorage.setItem('sestudio-harmopen', WS.harmOpen ? '1' : '0'); const s = WS.el.querySelector('.wh'); s.classList.toggle('open', WS.harmOpen); s.querySelector('.wh-h').setAttribute('aria-expanded', WS.harmOpen); return }
})
document.addEventListener('input', e => { const t = e.target; if (t.dataset.hw) { HW[t.dataset.hw] = +t.value / 100; t.parentElement.querySelector('em').textContent = t.value; HCACHE.clear(); refreshLive() } })
document.addEventListener('change', e => { if (e.target.dataset.hw) commit() })
document.addEventListener('keydown', e => { if (e.key === 'Escape' && WS.open && !e.target.closest('input, textarea')) closeAcc() })

// Screenshot aid: ?wacc=set|tape opens it on a mixed set; &harm opens the moves too.
const WQ = new URLSearchParams(location.search)
if (WQ.get('wacc')) setTimeout(() => {
  S.set = [...LIB.filter(t => t.al === 'Vexillology').slice(0, 5), ...LIB.filter(t => t.bpm >= 170).slice(0, 4), ...LIB.filter(t => t.m.word === 'Bright').slice(0, 3)]
  S.setOrder = 'blend'; if (WQ.get('wacc') === 'tape') S.order = 'blend'
  WS.harmOpen = WQ.has('harm'); render(false)
  if (WQ.get('scroll')) centre().scrollTop = +WQ.get('scroll')
  if (!WQ.has('closed')) openAcc(WQ.get('wacc'))
}, 400)
render(false)
