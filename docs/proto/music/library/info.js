// Track info panel: the focused track (or what's playing) at the top of the right column.

const PCS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' }
const STEPS = { Lydian: [0, 2, 4, 6, 7, 9, 11], Ionian: [0, 2, 4, 5, 7, 9, 11], Mixolydian: [0, 2, 4, 5, 7, 9, 10], Dorian: [0, 2, 3, 5, 7, 9, 10], Aeolian: [0, 2, 3, 5, 7, 8, 10], Phrygian: [0, 1, 3, 5, 7, 8, 10], Locrian: [0, 1, 3, 5, 6, 8, 10], 'Harmonic minor': [0, 2, 3, 5, 7, 8, 11] }
const INF = { min: false }

function harmonyOf(t) {
  const [kt, kq] = (t.key || '').split(' ')
  const tonic = FLAT[t.ton] || t.ton || FLAT[kt] || kt
  const mode = STEPS[t.mode] ? t.mode : /harmonic/i.test(t.mode || '') ? 'Harmonic minor' : kq === 'minor' ? 'Aeolian' : kq === 'major' ? 'Ionian' : null
  const i = PCS.indexOf(tonic)
  return i < 0 || !mode ? null : { tonic, mode, notes: STEPS[mode].map(s => PCS[(i + s) % 12]) }
}
function spectrumSvg(t, W) {
  const B = t.bands; if (!B) return ''
  const rows = B.length, cols = B[0].length, H = 54, cw = W / cols, ch = H / rows, mx = Math.max(1, ...B.flat())
  let s = ''
  B.forEach((row, r) => row.forEach((v, c) => { s += `<rect x="${(c * cw).toFixed(1)}" y="${((rows - 1 - r) * ch).toFixed(1)}" width="${(cw - .6).toFixed(1)}" height="${(ch - .6).toFixed(1)}" rx="1" fill="${trackColor(t)}" fill-opacity="${(.06 + .94 * v / mx).toFixed(2)}"/>` }))
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">${s}</svg>`
}
function renderInfo() {
  const el = $('info'); if (!el) return
  el.hidden = !tv('infoPanel', true)
  if (el.hidden) return
  const t = S.sel || S.playing, W = Math.max(220, el.clientWidth - 28)
  const h = harmonyOf(t), lists = PLAYLISTS.filter(p => p.tracks.includes(t)).map(p => p.name)
  const o = typeof ordered === 'function' ? ordered() : [], i = o.indexOf(t)
  const bal = t.bal || [0, 0, 0], inSet = S.set.includes(t)
  const fact = (k, v, sub = '') => `<div class="inf-f"><span>${k}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`
  el.innerHTML = `<div class="inf-top"><span class="inf-k">${S.sel ? (S.sel === S.playing ? 'Selected · playing' : 'Selected') : 'Playing'}</span><span style="flex:1"></span>
      ${S.sel ? `<button class="ib" data-infx title="Back to what's playing">${icon('close', 13)}</button>` : ''}<button class="ib" data-infmin title="${INF.min ? 'Show details' : 'Show less'}">${icon(INF.min ? 'down' : 'up', 14)}</button></div>
    <h3>${esc(t.t)}</h3><p class="inf-sub">${esc(t.ar)} · ${esc(t.al)}</p>
    ${INF.min ? '' : `
    ${typeof LIBPATHS !== 'undefined' && LIBPATHS[t.lib] ? `<p class="inf-path">${icon('folder', 12)}${esc([LIBPATHS[t.lib], ...(t.f ? t.f.split('/') : []), t.fn].join('\\'))}</p>` : ''}
    <div class="inf-sec"><span class="inf-l">Energy and sections</span>${sectionsSvg(t, W)}</div>
    <div class="inf-sec"><span class="inf-l">Spectrum <small>low → high, over time</small></span>${spectrumSvg(t, W)}</div>
    <div class="inf-grid">
      ${fact('Tempo', `${t.bpm || '?'} BPM`)}
      ${fact('Key', esc(t.key || '?'), t.cam || '')}
      ${fact('Mood', `<i class="dot" style="background:${t.m.color}"></i> ${t.m.word}`, t.mode ? `${t.ton || ''} ${t.mode}` : '')}
      ${fact('Energy', `${t.lvl || '?'} <span class="tab">${t.e ?? '?'}</span>`, t.ei != null ? `in ${t.ei} → out ${t.eo}` : '')}
      ${fact('Genre', esc(t.g || '?'))}
      ${fact('Length', fmtTime(t.d))}
    </div>
    <div class="inf-sec"><span class="inf-l">Balance</span><div class="inf-bal">${['Bass', 'Mids', 'Highs'].map((k, j) => `<span>${k}</span><i><u style="width:${Math.round(bal[j] * 100)}%;background:${trackColor(t)}"></u></i><b class="tab">${Math.round(bal[j] * 100)}</b>`).join('')}</div></div>
    ${h ? `<div class="inf-sec"><span class="inf-l">Harmony <small>${h.tonic} ${h.mode} · ${h.notes.join(' ')}</small></span>
      <div class="inf-keys">${PCS.map(n => `<span class="${n === h.tonic ? 'ton' : h.notes.includes(n) ? 'in' : ''}" style="--c:${t.m.color}">${n}</span>`).join('')}</div>
      <div class="inf-ladder">${LADDER.map(l => `<span class="${l.mode === h.mode ? 'on' : ''}" style="--c:${l.color}" title="${l.mode}">${l.word}</span>`).join('')}</div></div>` : ''}
    ${i >= 0 || lists.length ? `<div class="inf-sec inf-ctx">${i >= 0 ? `<p>In your set at <b>#${i + 1}</b>${i > 0 ? ` · from previous <i class="hc-d" style="background:${jm(o[i - 1], t)}"></i>${Math.round((1 - joinD(o[i - 1], t)) * 100)}` : ''}${i < o.length - 1 ? ` · to next <i class="hc-d" style="background:${jm(t, o[i + 1])}"></i>${Math.round((1 - joinD(t, o[i + 1])) * 100)}` : ''}</p>` : ''}${lists.length ? `<p>In ${lists.map(esc).join(', ')}</p>` : ''}</div>` : ''}`}
    <div class="inf-acts"><button class="btn pri" data-infplay>${icon('play', 12)}Play</button><button class="btn" data-infset>${icon(inSet ? 'close' : 'plus', 13)}${inSet ? 'Remove from set' : 'Add to set'}</button></div>`
}
document.addEventListener('click', e => {
  const q = s => e.target.closest(s)
  if (q('[data-infmin]')) { INF.min = !INF.min; renderInfo() }
  else if (q('[data-infx]')) { S.sel = null; render(false) }
  else if (q('[data-infplay]')) play(S.sel || S.playing)
  else if (q('[data-infset]')) toggleSet(S.sel || S.playing)
})
// Screenshot aid: ?focus selects a few tracks on the tape and focuses one.
if (new URLSearchParams(location.search).has('focus')) setTimeout(() => { const ts = laid.slice(2, 5).map(l => l.t); S.multi = new Set(ts.map(t => t.id)); S.sel = ts[1]; render(false) }, 300)
