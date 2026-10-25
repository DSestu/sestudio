import { useEffect, useState } from 'react'
import { getShelves } from '../../api'

// A few posters per catalogue, from its first shelf, so the phone menu's
// source tiles look like what they open onto. Fetched once per session: the
// server caches shelves for minutes, and posters barely change in between.

const PER_SOURCE = 3
const loaded = new Map<string, string[]>()
const pending = new Map<string, Promise<string[]>>()

function load(id: string): Promise<string[]> {
  let p = pending.get(id)
  if (!p) {
    p = getShelves(id)
      .then(shelves => (shelves[0]?.cards ?? []).map(c => c.poster_url).filter(Boolean).slice(0, PER_SOURCE))
      .catch(() => [])
      .then(posters => { loaded.set(id, posters); return posters })
    pending.set(id, p)
  }
  return p
}

/** Posters per catalogue id; a catalogue still loading is simply absent. */
export function useSourcePosters(ids: string[], enabled: boolean): Map<string, string[]> {
  const [, setTick] = useState(0)
  const key = ids.join('|')
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    for (const id of ids) {
      if (loaded.has(id)) continue
      void load(id).then(() => { if (!cancelled) setTick(t => t + 1) })
    }
    return () => { cancelled = true }
    // `key` identifies `ids`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])
  return loaded
}
