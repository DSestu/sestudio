import { LENGTHS, renderFlow, type Flow, type ScopeBody, type Slot } from '../../../musicFlows'

// What a flow row shows of a render (SPEC-flows-tab §4): rendered when a row opens, kept for the session.

const cache = new Map<string, Promise<Slot[]>>()
/** The last render seen per flow, for the artists line of a closed row. */
export const known = new Map<string, Slot[]>()

export function preview(id: string, seed: number, scope: ScopeBody = {}): Promise<Slot[]> {
  const key = `${id}:${seed}:${JSON.stringify(scope)}`
  if (!cache.has(key)) {
    cache.set(key, renderFlow(id, { minutes: 40, seed, ...scope }).then(
      r => { known.set(id, r.mix); return r.mix },
      e => { cache.delete(key); throw e },
    ))
  }
  return cache.get(key)!
}

const shapes = new Map<string, Promise<Slot[]>>()

/** The whole flow rendered once (seed 1), for its row's shape: the energy of what it really picks. */
export function shapeRender(id: string, scope: ScopeBody = {}): Promise<Slot[]> {
  const key = `${id}:${JSON.stringify(scope)}`
  if (!shapes.has(key)) {
    shapes.set(key, renderFlow(id, { seed: 1, ...scope }).then(r => r.mix, e => { shapes.delete(key); throw e }))
  }
  return shapes.get(key)!
}

/** A flow was saved: its row draws again from a new render. */
export function forgetShape(id: string) {
  for (const k of [...shapes.keys()]) if (k.startsWith(`${id}:`)) shapes.delete(k)
  for (const k of [...cache.keys()]) if (k.startsWith(`${id}:`)) cache.delete(k)
}

export const lengthLabel = (f: Flow) =>
  LENGTHS.find(l => l.id === f.length)?.label ?? (/^\d+$/.test(f.length) ? `${f.length} min` : 'Endless')
