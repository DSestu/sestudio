// Orbit (G) and tape (H) drawing, shared by the I/J/K browse mockups.

/** A fit profile: what a centre sounds like (one track, or a group's average). */
const profileOf = ts => ({ bpm: Math.round(avg(ts.map(t => t.bpm || 0).filter(Boolean))), b: avg(ts.map(t => t.m.b)), e: avg(ts.map(t => t.e || 0)) })
const tdist = (b, c) => b ? Math.min(...[b, b * 2, b / 2].map(v => Math.abs(v - c))) : 40
const fitDist = (t, p) => Math.min(1, tdist(t.bpm, p.bpm) / 40 * tv("fitTempo", .45) + Math.abs(t.m.b - p.b) / 4 * tv("fitMood", .3) + Math.abs((t.e || 0) - p.e) / 60 * tv("fitEnergy", .25))
const SECTORS = [...LADDER, EXOTIC]
const jit = id => (parseInt(id.slice(0, 6), 16) % 1000) / 1000

/** Orbit SVG: tracks around a profile; angle by mood, radius by distance. */
function orbitSvg({ W, H, p, tracks = T, hi = new Set(), skip = new Set(), labels = true, r0 = 60, rings = true }) {
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - (labels ? 26 : 8)
  let s = ''
  if (rings) [[.22, 'Fits next'], [.45, 'Close'], [.7, 'A step away'], [1, 'Far']].forEach(([f, l]) => {
    const rr = r0 + f * (R - r0)
    s += `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="none" stroke="oklch(60% .03 240 / ${f === .22 ? .5 : .18})" ${f === .22 ? '' : 'stroke-dasharray="2 5"'}/>`
    if (labels) s += `<text x="${cx}" y="${cy - rr - 5}" text-anchor="middle" font-size="11" fill="var(--dim)">${l}</text>`
  })
  SECTORS.forEach((m, i) => {
    const a = (i + .5) / SECTORS.length * Math.PI * 2 - Math.PI / 2, lr = R + 14
    if (labels) s += `<text x="${cx + Math.cos(a) * lr}" y="${cy + Math.sin(a) * lr + 4}" text-anchor="middle" font-size="11" fill="${m.color}" fill-opacity=".8">${m.word}</text>`
  })
  for (const t of tracks) {
    if (skip.has(t.id)) continue
    const d = fitDist(t, p), i = Math.max(0, SECTORS.findIndex(m => m.word === t.m.word))
    const a = (i + .1 + jit(t.id) * .8) / SECTORS.length * Math.PI * 2 - Math.PI / 2, rr = r0 + d * (R - r0)
    const on = hi.has(t.id), near = d < .22
    s += `<circle cx="${(cx + Math.cos(a) * rr).toFixed(1)}" cy="${(cy + Math.sin(a) * rr).toFixed(1)}" r="${(labels ? 2.6 : 1.8) + (near || on ? 1.2 : 0)}" fill="${t.m.color}" fill-opacity="${on ? 1 : near ? .9 : .3}" ${on ? 'stroke="oklch(97% .01 240)" stroke-width="1"' : ''}/>`
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="display:block">${s}</svg>`
}

/** The library in tape order: artist, then album, then track. */
const TAPE = []
for (const [ar, ats] of [...groupBy(T, t => t.ar)].sort((a, b) => b[1].length - a[1].length))
  for (const [al, ts] of [...groupBy(ats, t => t.al)].sort((a, b) => b[1].length - a[1].length)) TAPE.push({ ar, al, ts })

/**
 * Horizontal tape: groups laid end to end, width by length.
 * `keep(t)` false draws the track as a thin tick, so filtered gaps stay visible.
 */
function tapeHtml({ TW, TH = 280, groups, K = .24, hov, keep = () => true, label = g => g.al, sub, head = g => g.ar }) {
  let svg = '', html = '', tx = 26, lastHead = ''
  const yMid = TH - 112, amp = 120
  for (const g of groups) {
    if (tx > TW + 100) break
    const kept = g.ts.filter(keep)
    if (!kept.length) continue
    if (head(g) !== lastHead) { html += `<span class="lb ar" style="left:${tx}px">${esc(head(g))}</span>`; lastHead = head(g) }
    const gs = summarise(label(g), kept, '')
    html += `<span class="lb al" style="left:${tx}px">${esc(label(g))}<small>${sub ? sub(g, kept) : `${kept.length}${kept.length < g.ts.length ? ` of ${g.ts.length}` : ''} tracks · ${fmtDur(gs.dur)} · ${bpmRange(gs)}`}</small></span>`
    svg += `<line x1="${tx - 13}" y1="52" x2="${tx - 13}" y2="${TH - 12}" stroke="oklch(40% .02 240 / .5)"/>`
    for (const t of g.ts) {
      if (!keep(t)) { svg += `<rect x="${tx}" y="${yMid - 20}" width="2" height="40" rx="1" fill="oklch(45% .02 240 / .5)"/>`; tx += 5; continue }
      const w = t.d * K, on = t === hov
      svg += `<path d="${silhouette(t.curve, tx + 2, w - 4, amp, yMid)}" fill="${t.m.color}" fill-opacity="${on ? 1 : .8}"/>`
      if (on) svg += `<rect x="${tx - 1}" y="${yMid - amp / 2 - 10}" width="${w + 2}" height="${amp + 20}" rx="10" fill="none" stroke="var(--fg)" stroke-opacity=".85" stroke-width="1.5"/>`
      html += `<span class="lb tt ${on ? 'hov' : ''}" style="left:${tx + 2}px;width:${w - 6}px;top:${yMid + amp / 2 + 14}px">${esc(t.t)}<i>${t.m.word} · ${t.bpm}</i></span>`
      if (on) html += `<span class="hovbtn" style="left:${tx + w / 2 - 18}px;top:${yMid - 18}px">${icon('play', 16)}</span>`
      tx += w
    }
    tx += 30
  }
  return `<svg class="tape-svg" width="${TW}" height="${TH}" viewBox="0 0 ${TW} ${TH}">${svg}</svg>${html}`
}

/** Minimap of the whole tape with a window. */
function miniHtml(MW, startIdx, visibleSec, keep = () => true) {
  const total = T.reduce((a, t) => a + t.d, 0)
  let s = '', x = 0, x0 = 0
  TAPE.forEach((g, i) => { if (i === startIdx) x0 = x; for (const t of g.ts) { const w = t.d / total * MW, k = keep(t); s += `<rect x="${x.toFixed(2)}" y="${30 - (t.e || 5) / 100 * 26}" width="${Math.max(.6, w - .3).toFixed(2)}" height="${(t.e || 5) / 100 * 26}" fill="${k ? t.m.color : 'oklch(40% .02 240)'}" fill-opacity="${k ? .8 : .35}"/>`; x += w } })
  return `<svg viewBox="0 0 ${MW} 30" preserveAspectRatio="none" style="width:100%;height:100%;display:block">${s}</svg><span class="win" style="left:${x0}px;width:${visibleSec / total * MW}px"></span>`
}

/** Phone: the tape runs downwards, each row's height by length. */
function vtapeHtml(groups, { K = .1, hov, keep = () => true, max = 3 } = {}) {
  let h = '', lastAr = '', n = 0
  for (const g of groups) {
    const kept = g.ts.filter(keep)
    if (!kept.length) continue
    if (n++ >= max) break
    const gs = summarise(g.al, kept, '')
    if (g.ar !== lastAr) { h += `<div class="vsec ar">${esc(g.ar)}</div>`; lastAr = g.ar }
    h += `<div class="vsec"><b>${esc(g.al)}</b><small>${kept.length}${kept.length < g.ts.length ? ` of ${g.ts.length}` : ''} tracks · ${fmtDur(gs.dur)} · ${bpmRange(gs)}</small></div>`
    for (const t of kept) {
      const v = t.curve.length ? t.curve : [20, 20], m = v.length
      const top = v.map((e, k) => `${(k / (m - 1) * 100).toFixed(1)},${(50 - e / 100 * 48).toFixed(1)}`), bot = v.map((e, k) => `${(k / (m - 1) * 100).toFixed(1)},${(50 + e / 100 * 48).toFixed(1)}`).reverse()
      h += `<div class="vrow ${t === hov ? 'hov' : ''}" style="height:${Math.max(34, t.d * K)}px"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M${top.join('L')}L${bot.join('L')}Z" fill="${t.m.color}" fill-opacity=".55"/></svg><span>${esc(t.t)}<i>${t.m.word} · ${t.bpm}</i></span></div>`
    }
  }
  return h
}
