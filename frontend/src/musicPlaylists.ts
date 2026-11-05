import { useEffect, useSyncExternalStore } from 'react'
import type { AddPayload } from './musicQueue'

// The playlist tree (SPEC-music §13.2): folders, playlists (a playlist with
// parts is a set) and smart lists, kept on the server. This module is the API
// calls, a small shared copy of the tree, and the pure helpers over it.

export interface PlaylistItem {
  item_id: string
  library: string
  track_id: string
  /** Online items carry what the lists show. */
  source?: string
  title?: string
  artist?: string
  duration?: number
}
export interface Part {
  id: string
  name: string
  items: PlaylistItem[]
}
export interface SmartRules {
  genres: string[]
  bpm_min: number | null
  bpm_max: number | null
  added_days: number | null
  never_played: boolean
  /** Brightness on the mood ladder (-3 Unstable .. 3 Floating), and the energy score 0..100; absent on lists made before. */
  mood_min?: number | null
  mood_max?: number | null
  energy_min?: number | null
}
export interface PlaylistNode {
  id: string
  parent: string | null
  kind: 'folder' | 'playlist' | 'smart'
  name: string
  position: number
  items?: PlaylistItem[]
  parts?: Part[]
  rules?: SmartRules
}
export interface TreeNode extends PlaylistNode {
  children: TreeNode[]
}

/** Nest the flat list the server sends (already in order) under its folders. */
export function buildTree(nodes: PlaylistNode[]): TreeNode[] {
  const by = new Map<string, TreeNode>(nodes.map(n => [n.id, { ...n, children: [] }]))
  const roots: TreeNode[] = []
  for (const n of nodes) {
    const parent = n.parent ? by.get(n.parent) : undefined
    ;(parent ? parent.children : roots).push(by.get(n.id)!)
  }
  return roots
}

/** The rows of the tree as drawn: a folder's children only when it is open. */
export function visibleRows(roots: TreeNode[], collapsed: ReadonlySet<string>): { node: TreeNode; depth: number }[] {
  const out: { node: TreeNode; depth: number }[] = []
  const walk = (list: TreeNode[], depth: number) => {
    for (const node of list) {
      out.push({ node, depth })
      if (node.kind === 'folder' && !collapsed.has(node.id)) walk(node.children, depth + 1)
    }
  }
  walk(roots, 0)
  return out
}

export const isSet = (n: PlaylistNode) => !!n.parts?.length

/** Every item of a playlist in play order, across its parts. */
export const itemsOf = (n: PlaylistNode): PlaylistItem[] => [...(n.items ?? []), ...(n.parts ?? []).flatMap(p => p.items)]

export interface TrackFacts {
  duration: number
  bpm?: number
}
export interface PartStats {
  count: number
  duration: number
  bpmMin?: number
  bpmMax?: number
}

/** Track count, total duration and tempo range of some items; `facts` knows the local tracks. */
export function statsOf(items: PlaylistItem[], facts: (i: PlaylistItem) => TrackFacts | undefined): PartStats {
  const s: PartStats = { count: items.length, duration: 0 }
  for (const i of items) {
    const f = facts(i)
    if (!f) continue
    s.duration += f.duration
    if (f.bpm === undefined) continue
    s.bpmMin = Math.min(s.bpmMin ?? f.bpm, f.bpm)
    s.bpmMax = Math.max(s.bpmMax ?? f.bpm, f.bpm)
  }
  return s
}

/** The part (or loose list) an item sits in, and its index there. */
export function locate(n: PlaylistNode, itemId: string): { part: string | null; index: number } | null {
  const groups: [string | null, PlaylistItem[]][] = [[null, n.items ?? []], ...(n.parts ?? []).map((p): [string, PlaylistItem[]] => [p.id, p.items])]
  for (const [part, items] of groups) {
    const index = items.findIndex(i => i.item_id === itemId)
    if (index >= 0) return { part, index }
  }
  return null
}

// --- server ---------------------------------------------------------------------

const BASE = '/api/music/playlists'

async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { detail?: string } | null)?.detail ?? `playlists: ${res.status}`)
  return res.json()
}

let nodes: PlaylistNode[] = []
let loaded = false
const listeners = new Set<() => void>()

export async function loadPlaylists(): Promise<void> {
  nodes = await call<PlaylistNode[]>('', 'GET')
  loaded = true
  listeners.forEach(l => l())
}

/** The shared tree, fetched on first use. */
export function usePlaylists(): PlaylistNode[] {
  useEffect(() => {
    if (loaded) return
    loaded = true
    loadPlaylists().catch(() => { loaded = false })
  }, [])
  return useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => nodes)
}

/** Run a change, then refresh the tree. */
async function change<T>(path: string, method: string, body?: unknown): Promise<T> {
  const out = await call<T>(path, method, body)
  await loadPlaylists()
  return out
}

export const playlistApi = {
  create: (kind: PlaylistNode['kind'], name: string, parent: string | null = null, rules?: Partial<SmartRules>) =>
    change<PlaylistNode>('', 'POST', { kind, name, parent, rules }),
  rename: (id: string, name: string) => change<PlaylistNode>(`/${id}`, 'PATCH', { name }),
  setRules: (id: string, rules: Partial<SmartRules>) => change<PlaylistNode>(`/${id}`, 'PATCH', { rules }),
  move: (id: string, parent: string | null, index?: number) => change<PlaylistNode[]>(`/${id}/move`, 'POST', { parent, index }),
  remove: (id: string) => change<{ ok: boolean }>(`/${id}`, 'DELETE'),
  add: (id: string, tracks: AddPayload['tracks'], part?: string, index?: number) =>
    change<PlaylistNode>(`/${id}/items`, 'POST', { tracks, part, index }),
  removeItem: (id: string, itemId: string) => change<PlaylistNode>(`/${id}/items/${itemId}`, 'DELETE'),
  moveItem: (id: string, itemId: string, index: number, part?: string) =>
    change<PlaylistNode>(`/${id}/items/move`, 'POST', { item_id: itemId, index, part }),
  reorder: (id: string, order: string[], part?: string, whole = false) =>
    change<PlaylistNode>(`/${id}/items/reorder`, 'POST', { order, part, whole }),
  addPart: (id: string, name: string) => change<PlaylistNode>(`/${id}/parts`, 'POST', { name }),
  renamePart: (id: string, part: string, name: string) => change<PlaylistNode>(`/${id}/parts/${part}`, 'PATCH', { name }),
  removePart: (id: string, part: string) => change<PlaylistNode>(`/${id}/parts/${part}`, 'DELETE'),
  play: (id: string, part?: string) => call(`/${id}/play`, 'POST', { part }),
  smartTracks: (id: string) => call<{ library: string; track_id: string }[]>(`/${id}/tracks`, 'GET'),
}
