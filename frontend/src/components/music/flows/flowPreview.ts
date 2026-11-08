import { LENGTHS, renderFlow, type Flow, type Slot } from '../../../musicFlows'

// What a flow row shows of a render (SPEC-flows-tab §4): rendered when a row opens, kept for the session.

const cache = new Map<string, Promise<Slot[]>>()
/** The last render seen per flow, for the artists line of a closed row. */
export const known = new Map<string, Slot[]>()

export function preview(id: string, seed: number): Promise<Slot[]> {
  const key = `${id}:${seed}`
  if (!cache.has(key)) {
    cache.set(key, renderFlow(id, { minutes: 40, seed }).then(
      r => { known.set(id, r.mix); return r.mix },
      e => { cache.delete(key); throw e },
    ))
  }
  return cache.get(key)!
}

export const lengthLabel = (f: Flow) =>
  LENGTHS.find(l => l.id === f.length)?.label ?? (/^\d+$/.test(f.length) ? `${f.length} min` : 'Endless')
