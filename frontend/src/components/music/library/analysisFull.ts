import { useEffect, useSyncExternalStore } from 'react'

// The whole analysis of one track for the info panel (SPEC-music-library §2.5): the energy
// curve, the sections and the 8 band envelopes. Asked once per track, kept for the session.

export interface Section { label: string; start_bar: number; end_bar: number }
export interface FullAnalysis {
  energy?: number[]
  structure?: Section[]
  /** 8 bands × time, bass first. */
  bands?: number[][]
  duration?: number
}

const known = new Map<string, FullAnalysis>()
const inflight = new Set<string>()
const listeners = new Set<() => void>()
let version = 0

export function useFullAnalysis(id: string | undefined): FullAnalysis | undefined {
  useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => version)
  useEffect(() => {
    if (!id || known.has(id) || inflight.has(id)) return
    inflight.add(id)
    fetch(`/api/music/tracks/${encodeURIComponent(id)}/analysis`)
      .then(r => (r.ok ? r.json() : null))
      .then((a: FullAnalysis | null) => { if (a) { known.set(id, a); version++; listeners.forEach(l => l()) } })
      .catch(() => {})
      .finally(() => inflight.delete(id))
  }, [id])
  return id ? known.get(id) : undefined
}

/** `rows` × `cols` means of a band matrix, for a heat strip. */
export function coarseBands(bands: number[][], cols: number): number[][] {
  return bands.map(row => {
    const n = Math.min(cols, row.length)
    return Array.from({ length: n }, (_, i) => {
      const s = row.slice(Math.floor((row.length * i) / n), Math.floor((row.length * (i + 1)) / n))
      return s.reduce((a, b) => a + b, 0) / (s.length || 1)
    })
  })
}
