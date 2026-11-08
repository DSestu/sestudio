import { useSyncExternalStore } from 'react'

// What a flow plays from (SPEC-flows-tab §2): a library, artist, album or genre, each Only
// (nothing from outside it) or Lean on it (first when it fits the shape). Kept for the session.

export type SourceKind = 'library' | 'artist' | 'album' | 'genre'
export type Rule = 'only' | 'lean'
export interface Source { kind: SourceKind; value: string; rule: Rule; label?: string }
export type Then = 'stop' | 'similar'
export interface SourceOption { value: string; label: string; count: number; sub?: string }
export interface Scope { count: number; lean: number; seconds: number; narrowed: boolean }

export const KIND_LABEL: Record<SourceKind, string> = { genre: 'Genre', library: 'Library', artist: 'Artist', album: 'Album' }
export const KIND_ORDER: SourceKind[] = ['genre', 'library', 'artist', 'album']
/** A genre is a taste you lean on; a library, artist or album is a place you stay in. */
export const defaultRule = (k: SourceKind): Rule => (k === 'genre' ? 'lean' : 'only')
/** Out of an album, a flow stops; out of anything wider, similar music carries on. */
export const thenFor = (sources: Source[]): Then =>
  sources.some(s => s.kind === 'album' && s.rule === 'only') ? 'stop' : 'similar'

const KEY = 'sestudio.flowSources'
let sources: Source[] = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Source[] } catch { return [] }
})()
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export function setSources(next: Source[]) {
  sources = next
  localStorage.setItem(KEY, JSON.stringify(next))
  listeners.forEach(l => l())
}
export const useFlowSources = () => useSyncExternalStore(subscribe, () => sources)
const same = (a: Source, b: Source) => a.kind === b.kind && a.value.toLowerCase() === b.value.toLowerCase()
export const addSource = (s: Source) => setSources([...sources.filter(x => !same(x, s)), s])
export const removeSource = (s: Source) => setSources(sources.filter(x => !same(x, s)))
export const flipRule = (s: Source) => setSources(sources.map(x => (same(x, s) ? { ...x, rule: x.rule === 'only' ? 'lean' : 'only' } : x)))

/** What every render and play of the tab carries. */
export const scopeBody = (list: Source[]) =>
  list.length ? { sources: list.map(({ kind, value, rule }) => ({ kind, value, rule })), then: thenFor(list) } : {}

/** The sentence under the chips: "Only the Deadmau5 library, mostly Progressive House when it fits the shape". */
export function readBack(list: Source[]): string {
  const name = (s: Source) => (s.kind === 'library' ? `the ${s.label ?? s.value} library` : s.label ?? s.value)
  const only = KIND_ORDER.map(k => list.filter(s => s.rule === 'only' && s.kind === k).map(name).join(' or ')).filter(Boolean)
  const lean = list.filter(s => s.rule === 'lean').map(name).join(' or ')
  const head = only.length ? `Only ${only.join(', within ')}` : 'Your whole library'
  return lean ? `${head}, mostly ${lean} when it fits the shape` : head
}

/** "enough for 22 h", "enough for 38 min". */
export function enoughFor(seconds: number): string {
  const min = Math.round(seconds / 60)
  return min < 60 ? `enough for ${min} min` : `enough for ${Math.round(min / 60)} h`
}

export async function fetchOptions(): Promise<Record<SourceKind, SourceOption[]>> {
  const res = await fetch('/api/music/flows/sources')
  if (!res.ok) throw new Error(`sources: ${res.status}`)
  return res.json()
}

export async function fetchScope(list: Source[]): Promise<Scope> {
  const res = await fetch('/api/music/flows/scope', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sources: scopeBody(list).sources ?? [] }),
  })
  if (!res.ok) throw new Error(`scope: ${res.status}`)
  return res.json()
}
