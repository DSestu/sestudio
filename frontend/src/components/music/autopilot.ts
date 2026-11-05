import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { getSettings } from '../../api'
import { useDownloadedLibrary } from '../../downloadedLibrary'
import { albumsOf, type MusicTrack } from '../../musicLibrary'
import type { QueueState } from '../../musicQueue'
import { addTracks } from './adding'
import { buildSet } from './crates/harmonyApi'
import type { Join } from './crates/proximity'

// Autopilot (E7.3): while it is on, the queue keeps itself filled along an arc preset.
// The next few tracks show as ghost rows; when few are left they are added for real.

/** The settings' arc ids, their server preset names and chip labels. */
export const ARCS = [
  { id: 'warmup', preset: 'Warm-up, peak, cool-down', label: 'Warm-up' },
  { id: 'slow-burn', preset: 'Slow burn', label: 'Slow burn' },
  { id: 'dubstep', preset: 'Dubstep interlude', label: 'Dubstep' },
  { id: 'flat-out', preset: 'Flat out', label: 'Flat out' },
] as const
export type ArcId = (typeof ARCS)[number]['id']

const KEY = 'sestudio.autopilot'
/** Tracks left after the playing one below which Autopilot adds more, and how many ghosts show. */
const LOW = 3
const GHOSTS = 3

interface State { on: boolean; arc?: ArcId }
let state: State = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as State } catch { return { on: false } }
})()
const listeners = new Set<() => void>()
export const setAutopilot = (patch: Partial<State>) => {
  state = { ...state, ...patch }
  localStorage.setItem(KEY, JSON.stringify(state))
  listeners.forEach(l => l())
}
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l) }

export interface Ghost { track: MusicTrack; join: Join | null }
const NONE: Ghost[] = []

/** The switch and the arc in force (the chosen one, else the settings' default), for the control that sets them. */
export function useAutopilotState() {
  const st = useSyncExternalStore(subscribe, () => state)
  const [fallback, setFallback] = useState<ArcId>('warmup')
  useEffect(() => { getSettings().then(s => s.music_autopilot_arc && setFallback(s.music_autopilot_arc), () => {}) }, [])
  return { on: st.on, arc: st.arc ?? fallback }
}

/** The toggle, the arc in force and the ghost rows. */
export function useAutopilot(q: QueueState, enabled: boolean) {
  const { on: set, arc } = useAutopilotState()
  const on = enabled && set
  const lib = useDownloadedLibrary()
  const byId = useMemo(() => new Map(albumsOf(lib).flatMap(a => a.tracks).map(t => [t.id, t])), [lib])
  const last = q.items.at(-1)?.track_id
  const key = `${arc}|${q.items.map(i => i.track_id).join()}`
  const [res, setRes] = useState<{ key: string; ghosts: Ghost[] }>()
  useEffect(() => {
    if (!on || !last) return
    let live = true
    const preset = ARCS.find(a => a.id === arc)!.preset
    buildSet({ preset, length: 1800, start: last, skip: q.items.map(i => i.track_id) }).then(
      r => live && setRes({ key, ghosts: r.slots.slice(1, 1 + GHOSTS).flatMap(s => byId.has(s.id) ? [{ track: byId.get(s.id)!, join: s.join }] : []) }),
      () => live && setRes({ key, ghosts: [] }),
    )
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the queue's ids
  }, [on, last, key, byId])
  const ghosts = on && res?.key === key ? res.ghosts : NONE
  const left = q.items.length - 1 - q.current
  useEffect(() => {
    if (!ghosts.length || left >= LOW) return
    void addTracks(ghosts.map(g => ({ library: g.track.library, track_id: g.track.id })), undefined, `Autopilot added ${ghosts.length} to the queue`)
  }, [ghosts, left])
  return { on: set, arc, ghosts }
}
