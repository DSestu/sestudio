import type { Chunk, Flow, Layers } from '../../../musicFlows'

// What the flow editor does to a flow (SPEC-music-flows §8), as pure functions on a copy.

export type FlowDoc = Pick<Flow, 'chunks'> & Partial<Flow>

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/** The chunks the mix follows: the listener's choice at a fork, else the generator's, else the first future. */
export function pathOf(flow: FlowDoc, choices: Record<string, string>, auto: Record<string, string> = {}): Chunk[] {
  const by = new Map(flow.chunks.map(c => [c.id, c]))
  const out: Chunk[] = []
  let c = flow.chunks[0]
  while (c && !out.includes(c)) {
    out.push(c)
    const next = c.next.filter(n => by.has(n))
    const pick = [choices[c.id], auto[c.id]].find(x => x && next.includes(x)) ?? next[0]
    c = by.get(pick ?? '')!
  }
  return out
}

/** Each chunk's place on the path's 0..1 axis. */
export function spansOf(path: Chunk[]): { a: number; b: number; c: Chunk }[] {
  const total = path.reduce((s, c) => s + c.share, 0) || 1
  let acc = 0
  return path.map(c => {
    const s = { a: acc / total, b: (acc + c.share) / total, c }
    acc += c.share
    return s
  })
}

export function freshId(flow: FlowDoc, base: string): string {
  const stem = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chunk'
  const taken = new Set(flow.chunks.map(c => c.id))
  if (!taken.has(stem)) return stem
  let n = 2
  while (taken.has(`${stem}-${n}`)) n++
  return `${stem}-${n}`
}

/** Insert a chunk with *layers* at position *index* of the path (0 = before the first). */
export function insertChunk(flow: FlowDoc, path: Chunk[], index: number, name: string, layers: Layers): FlowDoc {
  const f = clone(flow)
  const by = new Map(f.chunks.map(c => [c.id, c]))
  const prev = index > 0 ? by.get(path[index - 1].id) : undefined
  const next = path[index] ? by.get(path[index].id) : undefined
  const id = freshId(f, name)
  const chunk: Chunk = { id, share: 1, next: next ? [next.id] : [], layers: clone(layers) }
  if (prev) {
    prev.next = next ? prev.next.map(n => (n === next.id ? id : n)) : [...prev.next, id]
    f.chunks.splice(f.chunks.indexOf(prev) + 1, 0, chunk)
  } else {
    f.chunks.unshift(chunk)
  }
  return f
}

/** A second future from this chunk on: its copy hangs from the same parent. Returns the flow and the copy's id. */
export function branchAt(flow: FlowDoc, path: Chunk[], chunkId: string): [FlowDoc, string] | null {
  const i = path.findIndex(c => c.id === chunkId)
  if (i <= 0) return null
  const f = clone(flow)
  const parent = f.chunks.find(c => c.id === path[i - 1].id)!
  const src = f.chunks.find(c => c.id === chunkId)!
  const copy: Chunk = { ...clone(src), id: freshId(f, `${chunkId}-b`) }
  parent.next = [...parent.next, copy.id]
  f.chunks.push(copy)
  return [f, copy.id]
}

/** Remove a chunk; its parents point at its futures instead. The last chunk cannot go. */
export function deleteChunk(flow: FlowDoc, chunkId: string): FlowDoc {
  if (flow.chunks.length <= 1) return flow
  const f = clone(flow)
  const gone = f.chunks.find(c => c.id === chunkId)
  if (!gone) return flow
  for (const c of f.chunks) {
    if (c.next.includes(chunkId)) c.next = [...new Set(c.next.flatMap(n => (n === chunkId ? gone.next : [n])))].filter(n => n !== c.id)
  }
  f.chunks = f.chunks.filter(c => c.id !== chunkId)
  // The first chunk went: its first future starts the flow.
  if (flow.chunks[0].id === chunkId && gone.next[0]) {
    const head = f.chunks.find(c => c.id === gone.next[0])!
    f.chunks = [head, ...f.chunks.filter(c => c !== head)]
  }
  return f
}

/** Move the boundary between path chunks i-1 and i to *at* (0..1 on the path), keeping the rest. */
export function resize(flow: FlowDoc, path: Chunk[], i: number, at: number): FlowDoc {
  const sp = spansOf(path)
  const A = sp[i - 1], B = sp[i]
  if (!A || !B) return flow
  const total = path.reduce((s, c) => s + c.share, 0)
  const x = Math.min(B.b - 0.03, Math.max(A.a + 0.03, at))
  const pair = A.c.share + B.c.share
  const left = Math.round((x - A.a) * total * 100) / 100
  const f = clone(flow)
  f.chunks.find(c => c.id === A.c.id)!.share = left
  f.chunks.find(c => c.id === B.c.id)!.share = Math.round((pair - left) * 100) / 100
  return f
}
