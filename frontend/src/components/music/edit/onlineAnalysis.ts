import { useSyncExternalStore } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import { refreshSummary } from '../../../musicMeta'
import type { OnlineHit } from '../../../musicSearch'
import { sourceLabel } from '../../../musicSearch'
import { toast } from '../toast'

// The playlist editor's Analyse button for online tracks (SPEC-playlist-edit, Server):
// ask the server to analyse, then follow its progress until the summary lands.
// Online tracks met in the editor are kept here too, so an analysed one ranks in Fits.

export interface Run { state: 'run' | 'done'; progress: number; bpm?: number }

const POLL_MS = 1500
const runs = new Map<string, Run>()
const seen = new Map<string, MusicTrack>()
let seenList: MusicTrack[] = []
const listeners = new Set<() => void>()
let version = 0
const changed = () => { version++; listeners.forEach(l => l()) }

async function poll(id: string) {
  let r: { partial?: boolean; progress?: number; bpm?: number } | undefined
  try {
    r = ((await (await fetch(`/api/music/tracks/analysis?ids=${encodeURIComponent(id)}`)).json()) as Record<string, typeof r>)[id]
  } catch {
    // Offline for a moment: ask again.
  }
  if (r?.partial) runs.set(id, { state: 'run', progress: r.progress ?? 0, bpm: r.bpm })
  // Done, or gone after a failure (the download can be refused): the summary decides what shows.
  else {
    runs.set(id, { state: 'done', progress: 1 })
    refreshSummary(id)
    changed()
    if (!r) toast('The analysis did not finish. Try again later.')
    return
  }
  changed()
  window.setTimeout(() => void poll(id), POLL_MS)
}

export async function analyseOnline(id: string) {
  if (runs.get(id)?.state === 'run') return
  const res = await fetch(`/api/music/tracks/${encodeURIComponent(id)}/analyse`, { method: 'POST' })
  if (!res.ok) {
    toast(((await res.json().catch(() => null)) as { detail?: string } | null)?.detail ?? 'Could not analyse it')
    return
  }
  runs.set(id, { state: 'run', progress: 0 })
  changed()
  window.setTimeout(() => void poll(id), POLL_MS)
}

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l) }

export function useRun(id: string): Run | undefined {
  useSyncExternalStore(subscribe, () => version)
  return runs.get(id)
}

/** An online hit as a music track (what Fits and the playlist take). */
export function trackOfHit(h: OnlineHit): MusicTrack {
  let t = seen.get(h.track_id)
  if (!t) {
    t = {
      id: h.track_id, library: 'online', libraryLabel: sourceLabel(h.source), source: h.source,
      title: h.title, artist: h.artist, album: '', duration: h.duration, folder: '',
    }
    seen.set(h.track_id, t)
    seenList = [...seen.values()]
    // Met while rendering a row: tell the others after this render.
    queueMicrotask(changed)
  }
  return t
}

/** Every online track met in the editor so far. */
export function useSeenOnline(): MusicTrack[] {
  useSyncExternalStore(subscribe, () => version)
  return seenList
}
