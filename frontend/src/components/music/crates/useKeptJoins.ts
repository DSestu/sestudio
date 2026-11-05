import { useCallback, useState } from 'react'

const storeKey = (set: string) => `sestudio.keptJoins.${set}`

const load = (set: string): ReadonlySet<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(storeKey(set)) ?? '[]')) } catch { return new Set() }
}

/** The joins of a set the mixer chose to keep ("Keep this join"), as item-id pairs; kept on this device. */
export function useKeptJoins(set: string): [ReadonlySet<string>, (key: string) => void] {
  const [state, setState] = useState({ set, kept: load(set) })
  // Another set opened in the same view: read its own list.
  const kept = state.set === set ? state.kept : load(set)
  const keep = useCallback((key: string) => {
    const next = new Set(kept).add(key)
    try { localStorage.setItem(storeKey(set), JSON.stringify([...next])) } catch { /* private mode: kept for this session only */ }
    setState({ set, kept: next })
  }, [set, kept])
  return [kept, keep]
}
