import type { OnlineHit } from '../../../musicSearch'

// Online search, merged (docs/proto/music/online-search.html, B): the three sites answer with
// the same song several times; one row per song, played from its best full source.

/** Plays from the first of these that has a full version. */
const SOURCE_ORDER = ['ytmusic', 'youtube', 'soundcloud']
/** SoundCloud answers with 30 s previews for label tracks. */
const PREVIEW_MAX = 31
/** One hour loops, ten hour loops… */
const LONG_MIN = 30 * 60
const JUNK = /\s*[([][^)\]]*\b(official|hd|4k|video|audio|lyrics?|remaster(ed)?|visuali[sz]er)\b[^)\]]*[)\]]/gi

export interface Song {
  key: string
  title: string
  /** The hit it plays from. */
  best: OnlineHit
  /** Every hit merged into it, best first. */
  hits: OnlineHit[]
  /** Seconds; 0 when no full source says. */
  duration: number
  /** Only videos carry it (a live set, a clip). */
  video: boolean
}

export interface Merged {
  songs: Song[]
  /** Loops and extended hours. */
  long: OnlineHit[]
  /** Hits that are not the searched song, and songs only found as previews. */
  other: OnlineHit[]
}

const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const isPreview = (h: OnlineHit) => h.source === 'soundcloud' && h.duration > 0 && h.duration <= PREVIEW_MAX
const rank = (h: OnlineHit) => [isPreview(h) ? 1 : 0, h.duration > 0 ? 0 : 1, SOURCE_ORDER.indexOf(h.source)]
const better = (a: OnlineHit, b: OnlineHit) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] }

/** `deadmau5 - Strobe (Official Video)` → `Strobe`; `deadmau5 "Strobe" Live` → `Strobe · Live`. */
export function cleanTitle(title: string, artistWords: string[]): string {
  let t = title.replace(JUNK, '').trim()
  // The whole run of artist words at the front ("Aphex Twin - "), not just its first word.
  const m = artistWords.length && t.match(new RegExp(`^(?:(?:${artistWords.map(esc).join('|')})[\\s,&]*)+(?:[-–—:]\\s*)?`, 'i'))
  if (m && m[0].length < t.length) t = t.slice(m[0].length)
  const q = t.match(/^["“](.+?)["”]\s*(.*)$/)
  if (q) t = q[2] ? `${q[1]} · ${q[2]}` : q[1]
  return t.trim()
}

export const songKey = (title: string) => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** `terms`: the search's name words, lower case. */
export function mergeOnline(hits: OnlineHit[], terms: string[]): Merged {
  // Words the results use as the artist ("deadmau5" in "deadmau5 - Strobe", or an uploader's name) more
  // often than in the song's name: a title need not repeat them. A vote, so a few "Angel - Massive Attack"
  // titles don't make "angel" an artist, and the first site to answer already decides it for most rows.
  const artistWords = terms.filter(w => {
    let artist = 0, song = 0
    for (const h of hits) {
      const p = h.title.toLowerCase().split(/\s[-–—]\s|:\s/)
      const head = p.length > 1 ? p[0] : '', rest = p.length > 1 ? p.slice(1).join(' ') : p[0]
      if (head.includes(w) || (h.artist.toLowerCase().includes(w) && !rest.includes(w))) artist++
      else if (rest.includes(w)) song++
    }
    return artist > 0 && artist >= song
  })
  const need = terms.filter(w => !artistWords.includes(w))
  const long: OnlineHit[] = [], other: OnlineHit[] = []
  const groups = new Map<string, { title: string; hits: OnlineHit[] }>()
  for (const h of hits) {
    const text = `${h.title} ${h.artist}`.toLowerCase()
    if (need.length ? !need.every(w => text.includes(w)) : !terms.some(w => text.includes(w))) { other.push(h); continue }
    if (h.duration >= LONG_MIN) { long.push(h); continue }
    const title = cleanTitle(h.title, artistWords)
    const key = songKey(title)
    const g = groups.get(key)
    if (g) g.hits.push(h)
    else groups.set(key, { title, hits: [h] })
  }
  const songs: Song[] = []
  for (const [key, g] of groups) {
    const sorted = [...g.hits].sort(better)
    if (sorted.every(isPreview)) { other.push(...sorted); continue }
    const full = sorted.find(h => !isPreview(h) && h.duration > 0)
    songs.push({ key, title: g.title, best: sorted[0], hits: sorted, duration: full?.duration ?? 0, video: sorted.every(h => h.kind === 'video') })
  }
  // Songs before videos, then the ones more sites carry, then a known full length; ties keep the sites' order.
  songs.sort((a, b) => Number(a.video) - Number(b.video) || new Set(b.hits.map(h => h.source)).size - new Set(a.hits.map(h => h.source)).size || Number(!a.duration) - Number(!b.duration))
  return { songs, long, other }
}
