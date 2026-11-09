import { folderName, type MusicTrack } from '../../../musicLibrary'
import { LEVELS, MOOD_ORDER, type Facts } from './facts'

// The explorer's grouping: a stack of up to 4 levels (Mood › Artist), built from
// presets on the icon rail or the Custom popover, shared with the tape (SPEC-music-library §2.2).

export type Dim = 'album' | 'artist' | 'library' | 'mood' | 'genre' | 'tempo' | 'energy' | 'key' | 'letter'
export type Preset = 'album' | 'artist' | 'files' | 'mood' | 'genre' | 'tempo' | 'energy' | 'key' | 'az' | 'flat'
export type GroupSort = 'natural' | 'az' | 'count'
export type TrackSort = 'natural' | 'title' | 'bpm' | 'energy' | 'length' | 'mood'

export const MAX_LEVELS = 4
export const NO_TEMPO = 'No tempo'
export const UNREAD = 'Unread'
export const NO_GENRE = 'No genre'

export const TEMPO_BANDS: [number, number, string][] = [
  [0, 100, 'Under 100'], [100, 120, '100–119'], [120, 126, '120–125'], [126, 131, '126–130'],
  [131, 140, '131–139'], [140, 160, '140–159'], [160, 180, '160–179'], [180, 999, '180 and up'],
]
export const tempoBand = (bpm?: number): string =>
  bpm ? (TEMPO_BANDS.find(([lo, hi]) => bpm >= lo && bpm < hi)?.[2] ?? NO_TEMPO) : NO_TEMPO

export interface DimDef {
  label: string
  /** The natural order of its groups; without one, albums/letters/keys go A–Z and the rest by count. */
  order?: string[]
  az?: boolean
  of: (t: MusicTrack, f: Facts) => string
}

export const DIMS: Record<Dim, DimDef> = {
  album: { label: 'Album', az: true, of: t => t.album || (t.folder ? t.albumName || folderName(t.folder) : t.libraryLabel) },
  artist: { label: 'Artist', of: t => t.artist },
  library: { label: 'Library', of: t => t.libraryLabel },
  mood: { label: 'Mood', order: [...MOOD_ORDER, UNREAD], of: (t, f) => f(t.id).mood?.word ?? UNREAD },
  genre: { label: 'Genre', of: (t, f) => f(t.id).genre || NO_GENRE },
  tempo: { label: 'Tempo', order: [...TEMPO_BANDS.map(b => b[2]), NO_TEMPO], of: (t, f) => tempoBand(f(t.id).bpm) },
  energy: { label: 'Energy', order: [...LEVELS, UNREAD], of: (t, f) => f(t.id).level ?? UNREAD },
  key: { label: 'Key', az: true, of: (t, f) => f(t.id).key || UNREAD },
  letter: { label: 'A–Z', az: true, of: t => (/^[a-z]/i.test(t.title) ? t.title[0].toUpperCase() : '#') },
}

/** The rail, in order. `files` is the file explorer, `flat` no levels. */
export const PRESETS: { id: Preset; label: string; dims: Dim[] }[] = [
  { id: 'album', label: 'Album', dims: ['album'] },
  { id: 'artist', label: 'Artist', dims: ['artist', 'album'] },
  { id: 'files', label: 'Library', dims: [] },
  { id: 'mood', label: 'Mood', dims: ['mood'] },
  { id: 'genre', label: 'Genre', dims: ['genre', 'artist'] },
  { id: 'tempo', label: 'Tempo', dims: ['tempo'] },
  { id: 'energy', label: 'Energy', dims: ['energy'] },
  { id: 'key', label: 'Key', dims: ['key'] },
  { id: 'az', label: 'A–Z', dims: ['letter'] },
  { id: 'flat', label: 'Flat', dims: [] },
]

export interface Grouping {
  dims: Dim[]
  /** The file explorer: ignores `dims`. */
  files: boolean
  groupSort: GroupSort
  trackSort: TrackSort
}

export const DEFAULT_GROUPING: Grouping = { dims: ['album'], files: false, groupSort: 'natural', trackSort: 'natural' }

/** The rail button lit for a grouping, if it is a preset. */
export function presetOf(g: Grouping): Preset | undefined {
  if (g.files) return 'files'
  return PRESETS.find(p => p.id !== 'files' && p.dims.join('>') === g.dims.join('>'))?.id
}

export const groupingLabel = (g: Grouping): string =>
  g.files ? 'Folders' : g.dims.length ? g.dims.map(d => DIMS[d].label).join(' › ') : 'Flat list'

export const GROUP_SORTS: [GroupSort, string][] = [['natural', 'Natural'], ['az', 'A–Z'], ['count', 'Most tracks']]
export const TRACK_SORTS: [TrackSort, string][] = [
  ['natural', 'Natural'], ['title', 'Title'], ['bpm', 'BPM'], ['energy', 'Energy'], ['length', 'Length'], ['mood', 'Bright → dark'],
]

export function sortLabel(g: Grouping): string {
  if (g.groupSort === 'natural' && g.trackSort === 'natural') return 'natural order'
  const name = <T,>(list: [T, string][], k: T) => list.find(s => s[0] === k)?.[1].toLowerCase()
  return `groups ${name(GROUP_SORTS, g.groupSort)} · tracks ${name(TRACK_SORTS, g.trackSort)}`
}

const az = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })

/** Tracks inside a group. Natural = title under albums, artists, letters, libraries and flat; BPM elsewhere. */
export function sortTracks(ts: MusicTrack[], g: Grouping, f: Facts): MusicTrack[] {
  const leaf = g.dims.at(-1)
  const k: TrackSort = g.trackSort !== 'natural' ? g.trackSort
    : !leaf || leaf === 'album' || leaf === 'artist' || leaf === 'letter' || leaf === 'library' ? 'title' : 'bpm'
  const cmp: Record<Exclude<TrackSort, 'natural'>, (a: MusicTrack, b: MusicTrack) => number> = {
    title: (a, b) => az(a.title, b.title),
    bpm: (a, b) => (f(a.id).bpm ?? 0) - (f(b.id).bpm ?? 0),
    energy: (a, b) => (f(a.id).energy ?? 0) - (f(b.id).energy ?? 0),
    length: (a, b) => a.duration - b.duration,
    mood: (a, b) => (f(b.id).brightness ?? -9) - (f(a.id).brightness ?? -9) || (f(a.id).energy ?? 0) - (f(b.id).energy ?? 0),
  }
  return [...ts].sort((a, b) => cmp[k as Exclude<TrackSort, 'natural'>](a, b) || az(a.title, b.title))
}

export interface GroupNode {
  /** Unique in the tree: the names down from the root joined by `|`. */
  key: string
  name: string
  /** The level's dimension; `folder` / `library` in the file explorer, `all` for the flat list. */
  kind: Dim | 'folder' | 'all'
  /** Every track under it, sorted. */
  all: MusicTrack[]
  /** Sub-groups, or null at the leaves. */
  kids: GroupNode[] | null
  /** File explorer only: the files directly in this folder, sorted by file name. */
  files?: MusicTrack[]
}

function groupBy<T>(list: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const t of list) {
    const k = key(t)
    const g = m.get(k)
    if (g) g.push(t)
    else m.set(k, [t])
  }
  return m
}

/** The tree for a grouping: one node per group at each level, leaves carry sorted tracks. */
export function treeOf(ts: MusicTrack[], g: Grouping, f: Facts, level = 0, prefix = ''): GroupNode[] {
  if (g.files) return fileTreeOf(ts)
  if (!g.dims.length) return [{ key: 'all', name: 'All tracks', kind: 'all', all: sortTracks(ts, g, f), kids: null }]
  const dim = g.dims[level]
  const d = DIMS[dim]
  const entries = [...groupBy(ts, t => d.of(t, f))]
  if (g.groupSort === 'az') entries.sort((a, b) => az(a[0], b[0]))
  else if (g.groupSort === 'count') entries.sort((a, b) => b[1].length - a[1].length || az(a[0], b[0]))
  else if (d.order) entries.sort((a, b) => d.order!.indexOf(a[0]) - d.order!.indexOf(b[0]))
  else if (d.az) entries.sort((a, b) => az(a[0], b[0]))
  else entries.sort((a, b) => b[1].length - a[1].length || az(a[0], b[0]))
  return entries.map(([name, tracks]) => {
    const key = prefix ? `${prefix}|${name}` : name
    const last = level >= g.dims.length - 1
    return { key, name, kind: dim, all: sortTracks(tracks, g, f), kids: last ? null : treeOf(tracks, g, f, level + 1, key) }
  })
}

/** The file name of a track: the end of its path, else its title. */
export const fileName = (t: MusicTrack): string => t.path?.split(/[\\/]/).pop() || t.title

/** `folder` split into its parts; `""` is the library root. */
const folderParts = (t: MusicTrack) => t.folder.split('/').filter(Boolean)

/** Library › real folders (nested) › files; folders first, both A–Z, like a file explorer. */
export function fileTreeOf(ts: MusicTrack[]): GroupNode[] {
  const dir = (key: string, name: string, kind: 'library' | 'folder', tracks: MusicTrack[], depth: number): GroupNode => {
    const here: MusicTrack[] = []
    const sub = new Map<string, MusicTrack[]>()
    for (const t of tracks) {
      const p = folderParts(t)[depth]
      if (p === undefined) here.push(t)
      else {
        const g = sub.get(p)
        if (g) g.push(t)
        else sub.set(p, [t])
      }
    }
    const kids = [...sub].sort((a, b) => az(a[0], b[0])).map(([n, g]) => dir(`${key}|${n}`, n, 'folder', g, depth + 1))
    return { key, name, kind, all: tracks, kids: kids.length ? kids : null, files: [...here].sort((a, b) => az(fileName(a), fileName(b))) }
  }
  return [...groupBy(ts, t => t.library)]
    .sort((a, b) => az(a[1][0].libraryLabel, b[1][0].libraryLabel))
    .map(([lib, g]) => dir(lib, g[0].libraryLabel, 'library', g, 0))
}

/** The node at a key, searching the tree. */
export function findNode(nodes: GroupNode[], key: string): GroupNode | undefined {
  for (const n of nodes) {
    if (n.key === key) return n
    if (n.kids && key.startsWith(n.key + '|')) {
      const hit = findNode(n.kids, key)
      if (hit) return hit
    }
  }
  return undefined
}

/** The leaves in tree order: what the tape shows as groups. */
export function leavesOf(nodes: GroupNode[]): GroupNode[] {
  const out: GroupNode[] = []
  const walk = (ns: GroupNode[]) => ns.forEach(n => {
    if (n.files?.length) out.push({ ...n, all: n.files, kids: null })
    if (n.kids) walk(n.kids)
    else if (!n.files) out.push(n)
  })
  walk(nodes)
  return out
}

/** The filter's words: lower case, split on spaces. */
export const filterWords = (text: string): string[] => text.toLowerCase().split(/\s+/).filter(Boolean)

const hasAll = (text: string, words: string[]) => { const low = text.toLowerCase(); return words.every(w => low.includes(w)) }

/** A track matches when every word is in its title, artist, album or file name. */
export const trackMatches = (t: MusicTrack, words: string[]): boolean =>
  hasAll([t.title, t.artist, t.album, t.albumName, fileName(t)].filter(Boolean).join(' '), words)

/**
 * The tree cut down to what matches (SPEC-music-library §2.2 Filter). A group whose name matches
 * stays whole and shut; any other group keeps only its matching tracks and sub-groups, and opens.
 * shortcut: every word must hit one name (a group or a track), not a group name plus a track name.
 */
export function filterTree(nodes: GroupNode[], words: string[]): { nodes: GroupNode[]; open: Set<string>; hits: number } {
  const open = new Set<string>()
  const hit = new Set<string>()
  const cut = (ns: GroupNode[]): GroupNode[] => ns.flatMap(n => {
    if (hasAll(n.name, words)) { n.all.forEach(t => hit.add(t.id)); return [n] }
    const kids = n.kids ? cut(n.kids) : null
    const files = n.files?.filter(t => trackMatches(t, words))
    const all = n.all.filter(t => trackMatches(t, words))
    const leaf = n.kids ? files ?? [] : all
    if (!kids?.length && !leaf.length) return []
    leaf.forEach(t => hit.add(t.id))
    open.add(n.key)
    const kept = new Set([...leaf, ...(kids ?? []).flatMap(k => k.all)])
    return [{ ...n, all: n.all.filter(t => kept.has(t)), kids: kids?.length ? kids : null, files }]
  })
  const out = cut(nodes)
  return { nodes: out, open, hits: hit.size }
}
