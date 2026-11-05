import { useSyncExternalStore } from 'react'

// The "Build a set" dialog: any screen calls openBuildSet(), the one <BuildSet />
// mounted in the Music view shows it.

export type Way = 'seed' | 'arcs' | 'bridge' | 'gap'

export interface BuildState {
  /** The way chosen; none shows the chooser. */
  way?: Way
  /** The playlist or set the result goes into; none offers only a new playlist. */
  node?: string
  /** A track the set grows from (From a track), or where a bridge starts. */
  seed?: string
  /** A mix builder flow the result fills (Draw the arcs from a flow's header). */
  flow?: string
}

let state: BuildState | null = null
const listeners = new Set<() => void>()
const set = (v: BuildState | null) => { state = v; listeners.forEach(l => l()) }

export const openBuildSet = (o: BuildState = {}) => set(o)
export const closeBuildSet = () => set(null)
export const updateBuild = (p: Partial<BuildState>) => state && set({ ...state, ...p })
export const setWay = (way?: Way) => updateBuild({ way })
export const useBuildSet = () => useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => state)
