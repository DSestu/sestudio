import type { Lean } from '../../../blend'
import { KINDS, eventDots, firstPath, type Flow } from '../../../musicFlows'
import { leansOf } from './lanes'

// What a flow does, in one sentence (SPEC-blend S1): the moves only, never a level.
// "Lifts, holds, then eases out" · "Holds all the way · Progressive House only".

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/** Where on the flow a thing happens, in words. */
function where(at: number) {
  return at < 0.15 ? 'first' : at < 0.4 ? 'early' : at < 0.6 ? 'halfway' : at < 0.85 ? 'late' : 'at the end'
}

/** The leans along the first path, neighbours with the same lean as one. */
function moves(flow: Pick<Flow, 'chunks'>): Lean[] {
  const out: Lean[] = []
  for (const c of firstPath(flow)) for (const b of leansOf(c.layers)) if (out.at(-1) !== b.lean) out.push(b.lean)
  return out
}

/** The moves: "Lifts all the way", "Holds, then eases out", "Lifts, holds, then eases out". */
function energyLine(flow: Pick<Flow, 'chunks'>): string {
  const m = moves(flow)
  if (!m.length) return 'Holds all the way'
  const word = (l: Lean, last: boolean) => (l === 'lift' ? 'lifts' : l === 'hold' ? 'holds' : last ? 'eases out' : 'eases off')
  if (m.length === 1) return `${cap(m[0] === 'ease' ? 'eases' : word(m[0], false))} all the way`
  const words = m.map((l, i) => word(l, i === m.length - 1))
  return cap(`${words.slice(0, -1).join(', ')}, then ${words.at(-1)}`)
}

/** An older flow's tempo curve, said as a move. */
function tempoLine(flow: Pick<Flow, 'chunks'>): string {
  const pts = firstPath(flow).flatMap(c => c.layers.tempo ?? [])
  if (pts.length < 2) return ''
  const a = pts[0][1], b = pts[pts.length - 1][1]
  if (Math.abs(b - a) < 5) return ''
  return b < a ? 'slows down' : 'speeds up'
}

function genreLine(flow: Pick<Flow, 'chunks'>): string {
  const blocks = firstPath(flow).flatMap(c => c.layers.genre ?? []).filter(g => g.genres.length)
  if (!blocks.length) return ''
  const g = blocks[0]
  const names = g.genres.join(' or ')
  return (g.strict ?? 'must') === 'must' ? `${names} only` : `mostly ${names}`
}

/** One plain sentence for a flow row; parts joined by " · ". */
export function flowSentence(flow: Pick<Flow, 'chunks'>): string {
  const events = eventDots(flow).map(d => {
    const name = (KINDS[d.kind] ?? d.kind).toLowerCase()
    return `${d.kind === 'break' ? 'a break' : name} ${where(d.at)}`
  })
  const parts = [energyLine(flow), ...events.slice(0, 2), tempoLine(flow), genreLine(flow)].filter(Boolean)
  return cap(parts.join(' · '))
}

/** "made today", "made yesterday", "made 3 Nov". */
export function madeWhen(created: number, now = Date.now()): string {
  const d = new Date(created * 1000), n = new Date(now)
  const day = (x: Date) => Math.floor((x.getTime() - x.getTimezoneOffset() * 60000) / 86400000)
  const ago = day(n) - day(d)
  if (ago <= 0) return 'made today'
  if (ago === 1) return 'made yesterday'
  return `made ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
}
