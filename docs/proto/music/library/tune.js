// Tune panel: every knob of the music page in one place, live, persisted, with feedback export.
// Loaded right after common.js so window.TUNE exists before anything reads tv().

const PARAMS = [
  // Layout
  { g: 'Layout', id: 'expW', label: 'Explorer width', type: 'range', min: 200, max: 400, step: 10, def: 320, unit: 'px' },
  { g: 'Layout', id: 'sideW', label: 'Right column width', type: 'range', min: 240, max: 440, step: 10, def: 340, unit: 'px' },
  { g: 'Layout', id: 'side', label: 'Right column shows', type: 'select', options: [['both', 'Orbit + Fits after'], ['orbit', 'Orbit only'], ['fits', 'Fits after only'], ['none', 'Nothing (hide)']], def: 'both' },
  { g: 'Layout', id: 'drawer', label: 'Set placement', type: 'select', options: [['C', 'Lane under the tape'], ['A', 'Dock at the bottom'], ['B', 'Side drawer']], def: 'C' },
  { g: 'Layout', id: 'hoverCard', label: 'Hover card on tracks', type: 'toggle', def: true },
  { g: 'Layout', id: 'hoverDelay', label: 'Hover card delay', type: 'range', min: 0, max: 800, step: 20, def: 180, unit: 'ms' },
  { g: 'Layout', id: 'setList', label: 'Track list under the set', type: 'select', options: [['rows', 'Rows with joins'], ['table', 'Table'], ['joins', 'Joins (A → B)'], ['off', 'Off']], def: 'rows' },
  { g: 'Layout', id: 'infoPanel', label: 'Track info at top of right column', type: 'toggle', def: true },
  { g: 'Layout', id: 'detail', label: 'Old track card under the tape', type: 'toggle', def: false },
  { g: 'Layout', id: 'minimap', label: 'Minimap above the tape', type: 'toggle', def: true },
  // Tape
  { g: 'Tape', id: 'tapeK', label: 'Zoom (px per second)', type: 'range', min: .06, max: .45, step: .01, def: .2 },
  { g: 'Tape', id: 'tapeFill', label: 'Stretch tracks to fill the width', type: 'toggle', def: true },
  { g: 'Tape', id: 'tapeMinW', label: 'Narrowest track', type: 'range', min: 10, max: 70, step: 2, def: 32, unit: 'px' },
  { g: 'Tape', id: 'tapeH', label: 'Track height', type: 'range', min: 50, max: 170, step: 5, def: 95, unit: 'px' },
  { g: 'Tape', id: 'labels', label: 'Labels under tracks', type: 'select', options: [['title', 'Title'], ['meta', 'Title + mood · BPM'], ['none', 'None']], def: 'title' },
  { g: 'Tape', id: 'color', label: 'Colour tracks by', type: 'select', options: [['mood', 'Mood'], ['energy', 'Energy'], ['genre', 'Genre']], def: 'mood' },
  { g: 'Tape', id: 'heads', label: 'Artist / album headers', type: 'toggle', def: true },
  { g: 'Tape', id: 'gap', label: 'Gap between albums', type: 'range', min: 4, max: 60, step: 2, def: 26, unit: 'px' },
  // Explorer
  { g: 'Explorer', id: 'groupUi', label: 'Group & sort controls', type: 'select', options: [['rail', 'Icon rail on the left edge'], ['builder', 'Builder: levels you compose'], ['chips', 'Chips: one-click presets'], ['menu', 'Dropdown (the old one)']], def: 'rail' },
  { g: 'Explorer', id: 'groupDef', label: 'Group by, on first load', type: 'select', options: [['album', 'Album'], ['artist', 'Artist ▸ Album'], ['hier', 'Library ▸ Artist ▸ Album'], ['mood', 'Mood'], ['genre', 'Genre ▸ Artist'], ['tempo', 'Tempo'], ['energy', 'Energy'], ['key', 'Key'], ['plain', 'Plain A–Z']], def: 'album', reload: true },
  { g: 'Explorer', id: 'density', label: 'Row density', type: 'select', options: [['compact', 'Compact'], ['comfy', 'Comfortable'], ['roomy', 'Roomy']], def: 'comfy' },
  { g: 'Explorer', id: 'treeBpm', label: 'BPM after track names', type: 'toggle', def: true },
  { g: 'Explorer', id: 'artistsShown', label: 'Groups before “more”', type: 'range', min: 3, max: 30, step: 1, def: 8 },
  { g: 'Explorer', id: 'searchFlat', label: 'Flat results while searching', type: 'toggle', def: true },
  { g: 'Explorer', id: 'onlineFirst', label: 'Online above library when searching', type: 'toggle', def: true },
  { g: 'Explorer', id: 'onlinePer', label: 'Online results per source', type: 'range', min: 2, max: 15, step: 1, def: 5 },
  { g: 'Explorer', id: 'srcYtm', label: 'Search YouTube Music', type: 'toggle', def: true },
  { g: 'Explorer', id: 'srcYt', label: 'Search YouTube', type: 'toggle', def: true },
  { g: 'Explorer', id: 'srcSc', label: 'Search SoundCloud', type: 'toggle', def: true },
  // Search
  { g: 'Search', id: 'soundWords', label: 'Read sound words (dark, 128…)', type: 'toggle', def: true },
  { g: 'Search', id: 'bpmTol', label: 'BPM tolerance (±)', type: 'range', min: 0, max: 15, step: 1, def: 10 },
  { g: 'Search', id: 'onlineSounds', label: 'Send sound words online too', type: 'toggle', def: false },
  { g: 'Search', id: 'dedupe', label: 'Show tracks in two libraries once', type: 'toggle', def: true, reload: true },
  // Orbit
  { g: 'Orbit', id: 'fitTempo', label: 'Fit weight: tempo', type: 'range', min: 0, max: 1, step: .05, def: 0.25 },
  { g: 'Orbit', id: 'fitMood', label: 'Fit weight: mood', type: 'range', min: 0, max: 1, step: .05, def: 0.45 },
  { g: 'Orbit', id: 'fitEnergy', label: 'Fit weight: energy', type: 'range', min: 0, max: 1, step: .05, def: .25 },
  { g: 'Orbit', id: 'fitRing', label: '“Fits next” ring', type: 'range', min: .08, max: .45, step: .01, def: .22 },
  { g: 'Orbit', id: 'dot', label: 'Dot size', type: 'range', min: 1, max: 6, step: .2, def: 2.4, unit: 'px' },
  { g: 'Orbit', id: 'fitsN', label: 'Rows in “Fits after it”', type: 'range', min: 0, max: 12, step: 1, def: 5 },
  // Blend
  { g: 'Blend', id: 'blendPlace', label: 'Blend by placement', type: 'select', options: [['sticky', 'Sticky bar at top of centre'], ['under', 'Under the row you clicked'], ['top', 'Top of the centre column']], def: 'sticky' },
  { g: 'Blend', id: 'jTempo', label: 'Tempo guard (outside Blend by)', type: 'range', min: 0, max: 1, step: .05, def: .3 },
  { g: 'Blend', id: 'goodBelow', label: 'Smooth join below', type: 'range', min: .05, max: .5, step: .01, def: 0.17 },
  { g: 'Blend', id: 'roughFrom', label: 'Rough join from', type: 'range', min: .2, max: .8, step: .01, def: .42 },
  { g: 'Blend', id: 'shapePull', label: 'How hard the shape pulls', type: 'range', min: 0, max: 3, step: .1, def: .8 },
  { g: 'Blend', id: 'setOrderDef', label: 'New set starts in', type: 'select', options: [['blend', 'Best blend'], ['mine', 'Your order']], def: 'blend', reload: true },
  { g: 'Blend', id: 'setShapeDef', label: 'Default shape', type: 'select', options: [['Lift', 'Lift'], ['Hold', 'Hold'], ['Ease', 'Ease'], ['Arc', 'Arc']], def: 'Arc', reload: true },
  { g: 'Blend', id: 'autoPin', label: 'Dropping on a slot pins it', type: 'toggle', def: true },
  { g: 'Blend', id: 'landedMsg', label: '“→ #n · blends x” message', type: 'toggle', def: true },
]
const GROUPS = [...new Set(PARAMS.map(p => p.g))]
const TKEY = 'sestudio-tune-v1', NKEY = 'sestudio-tune-notes-v1'
const DEF = Object.fromEntries(PARAMS.map(p => [p.id, p.def]))
window.TUNE = { ...DEF, ...JSON.parse(localStorage.getItem(TKEY) || '{}') }
try { if (location.hash.length > 2) Object.assign(window.TUNE, JSON.parse(decodeURIComponent(location.hash.slice(1)))) } catch {}
const NOTES = JSON.parse(localStorage.getItem(NKEY) || '{}')
const TS = { open: new URLSearchParams(location.search).has('notune') ? false : localStorage.getItem('sestudio-tune-open') ? localStorage.getItem('sestudio-tune-open') === '1' : !matchMedia('(max-width: 700px)').matches, groups: new Set(JSON.parse(localStorage.getItem('sestudio-tune-groups') || '["Layout"]')) }
const save = () => { localStorage.setItem(TKEY, JSON.stringify(Object.fromEntries(Object.entries(TUNE).filter(([k, v]) => DEF[k] !== v)))); localStorage.setItem(NKEY, JSON.stringify(NOTES)) }
const changed = p => TUNE[p.id] !== p.def
const fmtV = (p, v) => p.type === 'toggle' ? (v ? 'on' : 'off') : p.type === 'select' ? p.options.find(o => o[0] === v)?.[1] ?? v : `${+(+v).toFixed(2)}${p.unit || ''}`

/** Apply what CSS can carry; the rest is read through tv() on the next render. */
function applyTune() {
  const r = document.documentElement.style
  r.setProperty('--exp-w', TUNE.expW + 'px'); r.setProperty('--side-w', TUNE.side === 'none' ? '0px' : TUNE.sideW + 'px')
  r.setProperty('--tape-h', TUNE.tapeH + 'px')
  const b = document.body.classList
  ;['both', 'orbit', 'fits', 'none'].forEach(s => b.toggle('side-' + s, TUNE.side === s))
  ;['compact', 'comfy', 'roomy'].forEach(s => b.toggle('den-' + s, TUNE.density === s))
  b.toggle('no-detail', !TUNE.detail); b.toggle('no-mini', !TUNE.minimap)
}

function tuneHtml() {
  const n = PARAMS.filter(changed).length
  const ctl = p => {
    const v = TUNE[p.id], c = changed(p) ? 'chg' : ''
    if (p.type === 'range') return `<label class="tp ${c}"><span>${p.label}<b>${fmtV(p, v)}</b></span><input type="range" data-p="${p.id}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}"></label>`
    if (p.type === 'toggle') return `<label class="tp tg ${c}"><span>${p.label}</span><input type="checkbox" data-p="${p.id}" ${v ? 'checked' : ''}><i></i></label>`
    return `<label class="tp ${c}"><span>${p.label}</span><select data-p="${p.id}">${p.options.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`
  }
  return `<div class="tune-h"><b>Tune</b><small>${n ? `${n} changed` : 'all defaults'}</small><span style="flex:1"></span><button data-tclose title="Hide">${icon('close', 15)}</button></div>
    <div class="tune-b">${GROUPS.map(g => { const ps = PARAMS.filter(p => p.g === g), cn = ps.filter(changed).length, op = TS.groups.has(g); return `<section class="tg-g ${op ? 'open' : ''}"><button class="tg-h" data-tgrp="${g}">${icon('right', 12, 2.4)}<span>${g}</span>${cn ? `<em>${cn}</em>` : ''}${NOTES[g] ? `<em class="nt">note</em>` : ''}</button>
      ${op ? `<div class="tg-c">${ps.map(ctl).join('')}<textarea data-note="${g}" rows="2" placeholder="Notes on ${g.toLowerCase()}…">${esc(NOTES[g] || '')}</textarea>${cn ? `<button class="lnk" data-treset="${g}">Reset ${g.toLowerCase()}</button>` : ''}</div>` : ''}</section>` }).join('')}
      <section class="tg-g open"><div class="tg-c"><textarea data-note="General" rows="3" placeholder="General feedback…">${esc(NOTES.General || '')}</textarea></div></section></div>
    <div class="tune-f"><button class="btn pri" data-tcopy>${icon('plus', 13)}Copy feedback</button><button class="btn" data-tlink>Copy link</button><button class="btn ghost" data-treset="*">Reset all</button></div>`
}
function feedbackText() {
  const lines = ['Music page tuning feedback', '']
  for (const g of GROUPS) {
    const ps = PARAMS.filter(p => p.g === g && changed(p))
    if (!ps.length && !NOTES[g]) continue
    lines.push(`## ${g}`)
    for (const p of ps) lines.push(`- ${p.label}: ${fmtV(p, p.def)} → ${fmtV(p, TUNE[p.id])}`)
    if (NOTES[g]) lines.push(`- Note: ${NOTES[g].trim()}`)
    lines.push('')
  }
  if (NOTES.General) lines.push('## General', NOTES.General.trim(), '')
  if (lines.length === 2) lines.push('(no changes, no notes)')
  return lines.join('\n')
}
async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); toast(`${what} copied`) }
  catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast(`${what} copied`) }
}
function renderTune() {
  const el = document.getElementById('tune')
  el.className = 'tune' + (TS.open ? ' open' : '')
  el.innerHTML = TS.open ? tuneHtml() : `<button class="tune-tab" data-topen>${icon('settings', 16)}Tune${PARAMS.filter(changed).length ? ` · ${PARAMS.filter(changed).length}` : ''}</button>`
}
function initTune() {
  document.body.insertAdjacentHTML('beforeend', '<aside id="tune"></aside>')
  applyTune(); renderTune()
  const el = document.getElementById('tune')
  const set = (id, v) => {
    const p = PARAMS.find(q => q.id === id)
    TUNE[id] = v; save(); applyTune()
    if (p.reload) { renderTune(); toast('Applies on reload…'); setTimeout(() => location.reload(), 500); return }
    if (id === 'drawer' && typeof D !== 'undefined') { D.v = v; D.open = true }
    if (typeof render === 'function') render(false)
    if (['srcYtm', 'srcYt', 'srcSc', 'onlineSounds'].includes(id) && typeof E !== 'undefined') { E.q = '\u0000'; renderIndex() }
  }
  el.addEventListener('input', e => {
    const t = e.target
    if (t.dataset.note) { NOTES[t.dataset.note] = t.value; save(); return }
    if (!t.dataset.p) return
    const p = PARAMS.find(q => q.id === t.dataset.p)
    const v = p.type === 'toggle' ? t.checked : p.type === 'range' ? +t.value : t.value
    set(p.id, v)
    const lab = t.closest('.tp'); lab.classList.toggle('chg', changed(p)); const b = lab.querySelector('b'); if (b) b.textContent = fmtV(p, v)
    el.querySelector('.tune-h small').textContent = PARAMS.filter(changed).length ? `${PARAMS.filter(changed).length} changed` : 'all defaults'
  })
  el.addEventListener('change', e => { if (e.target.dataset.p) renderTune() })
  el.addEventListener('click', e => {
    const q = s => e.target.closest(s)
    if (q('[data-topen]')) { TS.open = true; localStorage.setItem('sestudio-tune-open', '1'); renderTune() }
    else if (q('[data-tclose]')) { TS.open = false; localStorage.setItem('sestudio-tune-open', '0'); renderTune() }
    else if (q('[data-tgrp]')) { const g = q('[data-tgrp]').dataset.tgrp; TS.groups.has(g) ? TS.groups.delete(g) : TS.groups.add(g); localStorage.setItem('sestudio-tune-groups', JSON.stringify([...TS.groups])); renderTune() }
    else if (q('[data-treset]')) {
      const g = q('[data-treset]').dataset.treset, ps = PARAMS.filter(p => g === '*' || p.g === g), needsReload = ps.some(p => p.reload && changed(p))
      ps.forEach(p => TUNE[p.id] = p.def); save(); applyTune(); renderTune()
      if (needsReload) location.reload(); else { if (typeof D !== 'undefined') D.v = TUNE.drawer; render(false) }
    }
    else if (q('[data-tcopy]')) copy(feedbackText(), 'Feedback')
    else if (q('[data-tlink]')) copy(location.origin + location.pathname + '#' + encodeURIComponent(JSON.stringify(Object.fromEntries(Object.entries(TUNE).filter(([k, v]) => DEF[k] !== v)))), 'Link')
  })
}
window.DRAWER_DEFAULT = window.TUNE.drawer
window.DRAWER_LOCK = true
