import { KINDS, energyShape, eventDots, firstPath, type Flow } from '../../../musicFlows'

// What a flow does, in one sentence (SPEC-flows-tab §2): "Lively to all out · up a fifth halfway".

export const ENERGY_WORDS = ['calm', 'easy', 'lively', 'high', 'all out'] as const
export const energyWord = (v: number) => ENERGY_WORDS[Math.max(0, Math.min(4, Math.floor(v * 5)))]
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/** Where on the flow a thing happens, in words. */
function where(at: number) {
  return at < 0.15 ? 'at the start' : at < 0.4 ? 'early' : at < 0.6 ? 'halfway' : at < 0.85 ? 'late' : 'at the end'
}

/** The energy line: "Easy, rising to lively", "Lively all the way", "Easy, up to all out, down to easy". */
function energyLine(flow: Pick<Flow, 'chunks'>): string {
  const pts = energyShape(flow)
  if (!pts) return ''
  const runs: { word: string; v: number }[] = []
  for (const [, v] of pts) {
    const word = energyWord(v)
    if (runs.at(-1)?.word !== word) runs.push({ word, v })
  }
  if (runs.length === 1) {
    const flat = pts.every(([, v]) => Math.abs(v - pts[0][1]) < 0.02)
    return `${cap(runs[0].word)} ${flat ? 'all the way' : 'and steady'}`
  }
  if (runs.length === 2) {
    const [a, b] = runs
    return b.v > a.v ? `${cap(a.word)}, rising to ${b.word}` : `${cap(a.word)} down to ${b.word}`
  }
  return [cap(runs[0].word), ...runs.slice(1).map((r, i) => `${r.v > runs[i].v ? 'up' : 'down'} to ${r.word}`)].join(', ')
}

function tempoLine(flow: Pick<Flow, 'chunks'>): string {
  const pts = firstPath(flow).flatMap(c => c.layers.tempo ?? [])
  if (pts.length < 2) return ''
  const a = pts[0][1], b = pts[pts.length - 1][1]
  if (Math.abs(b - a) < 5) return ''
  return `${b < a ? 'slows' : 'speeds up'} to ${Math.round(b)}`
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
  return parts.length ? cap(parts.join(' · ')) : 'Any energy, any key'
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
