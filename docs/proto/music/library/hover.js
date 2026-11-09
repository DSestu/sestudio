// Hover card: everything about a track, shown fast wherever a track appears
// (tape, explorer, set, orbit dots, Fits after it). Mouse only; touch keeps tap-to-select.

const HC = { el: null, timer: 0, hideT: 0, anchor: null }
function hoverHit(target) {
  const a = target.closest?.('[data-id], [data-pick]')
  if (!a || a.closest('#hcard')) return null
  const t = byId(a.dataset.id || a.dataset.pick)
  return t ? { t, a } : null
}
function sectionsSvg(t, W = 296) {
  const st = t.st || [], end = Math.max(1, ...st.map(s => s[2]))
  const shade = { intro: 30, buildup: 50, build: 50, drop: 72, break: 38, breakdown: 38, outro: 28, verse: 45, chorus: 65 }
  const curve = t.curve.length ? t.curve : [20, 20], n = curve.length, H = 56
  const pts = curve.map((e, i) => `${(i / (n - 1) * W).toFixed(1)},${(H - 4 - e / 100 * (H - 8)).toFixed(1)}`)
  return `<svg width="${W}" height="${H + 22}" viewBox="0 0 ${W} ${H + 22}" style="display:block">
    <path d="M0,${H}L${pts.join('L')}L${W},${H}Z" fill="${trackColor(t)}" fill-opacity=".35"/><path d="M${pts.join('L')}" fill="none" stroke="${trackColor(t)}" stroke-width="1.6"/>
    ${st.map(([l, a, b]) => { const x = a / end * W, w = Math.max(2, (b - a) / end * W - 2); return `<rect x="${x}" y="${H + 4}" width="${w}" height="14" rx="3" fill="oklch(${shade[l] ?? 45}% .04 240)"/>${w > 30 ? `<text x="${x + 4}" y="${H + 14.5}" font-size="9.5" fill="oklch(92% .01 240)">${esc(l)}</text>` : ''}` }).join('')}</svg>`
}
function cardHtml(t) {
  if (t.online) return `<div class="hc-on"><img src="${t.thumb}" alt=""><div><h4>${esc(t.t)}</h4><p>${esc(t.ar || 'Unknown artist')} · ${esc(t.al)}${t.d ? ' · ' + fmtTime(t.d) : ''}${t.kind ? ' · ' + t.kind : ''}</p></div></div>
    <p class="hc-note">Not analysed yet. Mood, tempo and energy arrive when you add it to the set or the queue.</p>`
  const lists = PLAYLISTS.filter(p => p.tracks.includes(t)).map(p => p.name)
  const o = typeof ordered === 'function' ? ordered() : [], i = o.indexOf(t)
  const jn = (a, b) => `<i class="hc-d" style="background:${jm(a, b)}"></i>${Math.round((1 - joinD(a, b)) * 100)}`
  return `<h4>${esc(t.t)}</h4><p>${esc(t.ar)} · ${esc(t.al)} · ${esc(t.lib)}</p>${LIBPATHS && LIBPATHS[t.lib] ? `<p class="hc-path">${icon('folder', 12)}${esc([LIBPATHS[t.lib], ...(t.f ? t.f.split('/') : []), t.fn].join('\\'))}</p>` : ''}
    ${sectionsSvg(t)}
    <div class="hc-chips"><span><i class="dot" style="background:${t.m.color}"></i>${t.m.word}${t.mode ? ` <small>${t.ton || ''} ${t.mode}</small>` : ''}</span>${t.key ? `<span>${t.key}${t.cam ? ` <small>${t.cam}</small>` : ''}</span>` : ''}<span class="tab">${t.bpm || '?'} BPM</span><span>${t.lvl || 'Energy'} <small class="tab">${t.e ?? '?'}</small></span>${t.g ? `<span>${esc(t.g)}</span>` : ''}<span class="tab">${fmtTime(t.d)}</span></div>
    ${i >= 0 ? `<p class="hc-set">In your set at #${i + 1}${i > 0 ? ` · from previous ${jn(o[i - 1], t)}` : ''}${i < o.length - 1 ? ` · to next ${jn(t, o[i + 1])}` : ''}</p>` : ''}
    ${lists.length ? `<p class="hc-meta">In ${lists.map(esc).join(', ')}</p>` : ''}
    <p class="hc-hint">Click to select · double-click to play · drag into your set</p>`
}
function showCard(t, a) {
  if (!HC.el) { HC.el = document.createElement('div'); HC.el.id = 'hcard'; document.body.appendChild(HC.el) }
  HC.anchor = a; HC.el.innerHTML = cardHtml(t)
  const r = a.getBoundingClientRect(), w = HC.el.offsetWidth, h = HC.el.offsetHeight
  const x = Math.min(innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2))
  const above = r.top > h + 24, y = above ? r.top - h - 10 : Math.min(innerHeight - h - 8, r.bottom + 10)
  HC.el.style.left = x + 'px'; HC.el.style.top = y + 'px'; HC.el.dataset.side = above ? 'up' : 'down'
  HC.el.classList.add('on')
}
function hideCard() { HC.el?.classList.remove('on'); HC.anchor = null }
document.addEventListener('pointerover', e => {
  if (e.pointerType !== 'mouse' || !tv('hoverCard', true)) return
  const h = hoverHit(e.target); if (!h) return
  clearTimeout(HC.hideT)
  if (HC.anchor === h.a) return
  clearTimeout(HC.timer)
  // Once a card is up, moving to the next track swaps it at once.
  if (HC.el?.classList.contains('on')) showCard(h.t, h.a)
  else HC.timer = setTimeout(() => showCard(h.t, h.a), tv('hoverDelay', 180))
})
document.addEventListener('pointerout', e => {
  const to = e.relatedTarget
  if (HC.anchor && to && HC.anchor.contains(to)) return
  if (to && hoverHit(to)) return
  clearTimeout(HC.timer); HC.hideT = setTimeout(hideCard, 90)
})
document.addEventListener('pointerdown', () => { clearTimeout(HC.timer); hideCard() })
document.addEventListener('scroll', () => hideCard(), true)
document.addEventListener('dragstart', () => hideCard())
// Screenshot aid: ?hovercard shows the card on the first tape track.
if (new URLSearchParams(location.search).has('hovercard')) setTimeout(() => { const a = document.querySelectorAll('.trk')[3]; if (a) showCard(byId(a.dataset.id), a) }, 400)
