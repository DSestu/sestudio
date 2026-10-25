import type { DownloadedFile, DownloadedTitle } from './api'
import { matchKey } from './topMatch'
import type { WatchEntry } from './watchState'

// What is on disk, as shows rather than files: the search page talks about
// shows, and a show can be spread over several folders, spellings and copies.
// Real cases this has to get right:
// - South Park: `south-park-la-serie-vf` and `south_park`, 26 seasons, most
//   episodes stored twice → one show, one row per episode with its copies.
// - One Piece: one folder per episode, `One Piece Yabai - 042 - …` (MULTI) and
//   `One Piece Kaï - 099 - …` (VOSTFR) → one show whose two cuts act as seasons.

export interface DiskCopy {
  title: DownloadedTitle
  file: DownloadedFile
}

export interface DiskEpisode {
  number: number
  /** The same episode stored more than once (another folder, a re-encode). */
  copies: DiskCopy[]
}

export interface DiskSeason {
  /** Season number, or a cut's place in the show (1, 2…) when the show has cuts. */
  season: number
  /** "Season 14", or a cut's own name ("Yabai"). */
  label: string
  /** Set for a cut: its episodes are numbered across the whole show. */
  cut: boolean
  episodes: DiskEpisode[]
}

export interface DiskShow {
  /** `matchKey` of the name, to compare with a search result's title. */
  key: string
  name: string
  seasons: DiskSeason[]
  /** Distinct episodes, a copy counted once. */
  episodes: number
  files: number
  size: number
}

// "One Piece Yabai - 042 - Le bon rhum de Binks - 1080p.MULTI.x264 [Livaï]" or
// "Naruto Kai 01 - Des personnes sur qui compter": a release named per episode,
// the show and number in its name.
const RELEASE = /^(.+?)\s+(?:-\s+(\d{1,4})|(\d{2,4}))\s+-\s/
// Where a release name stops being the title: its season, quality or source tag.
const TAIL = /\b(?:s\d{1,2}(?:e\d+)?|season|saison|\d{3,4}p|4k|repack|complete|bluray|webrip|web dl|x26[45]|hevc|10bit)\b.*$/
// Folder-name noise that isn't part of a title (after `matchKey`).
const NOISE = /\b(?:la serie|vf|vostfr|multi|truefrench|french)\b/g

function keyOf(name: string): string {
  return matchKey(name.replace(/\[[^\]]*\]/g, ' '))
    .replace(TAIL, '')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // "Loki (2021)": the year tells remakes apart on TMDB, not on disk.
    .replace(/\s(?:19|20)\d{2}$/, '')
}

interface Unit {
  base: string
  key: string
  top: string
  season: number
  isFilm: boolean
  /** Named per episode, so its number counts across the whole show. */
  release: boolean
  copies: { number: number; copy: DiskCopy }[]
}

function unitOf(title: DownloadedTitle): Unit {
  const release = RELEASE.exec(title.series)
  const base = release ? release[1].trim() : title.series
  return {
    base,
    key: keyOf(base),
    // Only a nested folder groups: a lone folder is just the show's own.
    top: title.folder.includes('/') ? title.folder.split('/')[0] : '',
    season: release ? 0 : title.season,
    isFilm: title.is_film && !release,
    release: !!release,
    copies: title.files.map(file => ({ number: release ? Number(release[2] ?? release[3]) : file.number, copy: { title, file } })),
  }
}

const words = (key: string) => key.split(' ')

/** How many leading words two keys share. */
function sharedWords(a: string, b: string): number {
  const x = words(a), y = words(b)
  let n = 0
  while (n < x.length && n < y.length && x[n] === y[n]) n++
  return n
}

/** The show's own name when a folder spells it plainly, else the key
 *  title-cased: "south_park" → "South Park". */
function displayName(raws: string[], key: string): string {
  const real = raws.find(r => / /.test(r) && matchKey(r) === key)
  return real ?? key.replace(/(^|\s)\p{L}/gu, c => c.toUpperCase())
}

function episodesOf(units: Unit[]): DiskEpisode[] {
  const byNumber = new Map<number, DiskEpisode>()
  for (const u of units) {
    for (const { number, copy } of u.copies) {
      const ep = byNumber.get(number) ?? { number, copies: [] }
      ep.copies.push(copy)
      byNumber.set(number, ep)
    }
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number)
}

export function groupOnDisk(titles: DownloadedTitle[]): DiskShow[] {
  // Same cleaned name → same show, whichever folder it sits in.
  const groups = new Map<string, Unit[]>()
  for (const t of titles) {
    const u = unitOf(t)
    if (!u.key) continue
    groups.set(u.key, [...(groups.get(u.key) ?? []), u])
  }
  // Per-episode releases whose names differ only past their first two words,
  // kept in one folder, are cuts of one show ("One Piece Yabai" and "One Piece
  // Kaï" under "One Piece Kaï/"). Only those: without episode numbers, there is
  // no telling the parts apart.
  const shows: Unit[][][] = []
  for (const group of groups.values()) {
    const { top, release, key } = group[0]
    const home = top && release && shows.find(s => s[0][0].top === top && s[0][0].release && sharedWords(s[0][0].key, key) >= 2)
    if (home) home.push(group)
    else shows.push([group])
  }

  return shows.map(cuts => {
    const all = cuts.flat()
    let key: string, name: string, seasons: DiskSeason[]
    if (cuts.length > 1) {
      const n = Math.min(...cuts.map(c => sharedWords(cuts[0][0].key, c[0].key)))
      key = words(cuts[0][0].key).slice(0, n).join(' ')
      name = cuts[0][0].base.split(/\s+/).slice(0, n).join(' ')
      seasons = cuts
        .map(c => ({ label: c[0].base.split(/\s+/).slice(n).join(' '), episodes: episodesOf(c) }))
        .sort((a, b) => a.episodes[0].number - b.episodes[0].number)
        .map((c, i) => ({ season: i + 1, label: c.label, cut: true, episodes: c.episodes }))
    } else {
      key = all[0].key
      name = displayName(all.map(u => u.base), key)
      const numbers = [...new Set(all.map(u => u.season))].sort((a, b) => a - b)
      seasons = numbers.map(season => {
        const units = all.filter(u => u.season === season)
        return {
          season,
          label: units.every(u => u.isFilm) ? 'Film' : season ? `Season ${season}` : units.every(u => u.release) ? 'Episodes' : 'Extras',
          cut: false,
          episodes: episodesOf(units),
        }
      })
    }
    const files = all.flatMap(u => u.copies)
    return {
      key,
      name,
      seasons,
      episodes: seasons.reduce((n, s) => n + s.episodes.length, 0),
      files: files.length,
      size: files.reduce((n, f) => n + f.copy.file.size, 0),
    }
  })
}

export interface DiskResume {
  season: DiskSeason
  episode: DiskEpisode
  /** False when nothing has been watched yet: the first episode, not a resume. */
  resume: boolean
}

/** "S14 E13", or "Yabai E42" for a cut. */
export function episodeCode(season: DiskSeason, episode: DiskEpisode): string {
  return season.cut ? `${season.label} E${episode.number}` : `S${String(season.season).padStart(2, '0')} E${String(episode.number).padStart(2, '0')}`
}

/**
 * Where to pick a show up from disk: the episode last watched if it wasn't
 * finished, else the next one on disk; the first episode with no history.
 */
export function resumePoint(show: DiskShow, history: WatchEntry[]): DiskResume | null {
  const order = show.seasons.flatMap(season => season.episodes.map(episode => ({ season, episode })))
  if (!order.length) return null
  const last = history
    .filter(e => matchKey(e.series) === show.key)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  if (last) {
    // A cut numbers episodes across the show, so the season can't be matched there.
    const at = order.findIndex(o => o.episode.number === last.number && (o.season.cut || o.season.season === last.season))
    const next = at < 0 ? undefined : last.watched ? order[at + 1] : order[at]
    if (next) return { ...next, resume: true }
  }
  return { ...order[0], resume: false }
}

export interface EpisodeHit {
  season: DiskSeason
  episode: DiskEpisode
  copy: DiskCopy
}

/** The plainest of an episode's copies ("x.mp4" over "x.ia.mp4"): the original. */
export function plainCopy(episode: DiskEpisode): DiskCopy {
  return episode.copies.reduce((a, b) => (b.file.title.length < a.file.title.length ? b : a))
}

/**
 * Episodes on disk whose own title matches a search ("myst" → South Park's
 * "Mysterion Rises"), grouped by show. The show the search names is left out:
 * every one of its episodes would match, and it has the hero for that.
 */
export function episodeHits(shows: DiskShow[], query: string): { show: DiskShow; hits: EpisodeHit[] }[] {
  const want = matchKey(query)
  if (want.length < 3) return []
  return shows
    .filter(show => show.key !== want)
    .map(show => ({
      show,
      hits: show.seasons.flatMap(season => season.episodes
        .map(episode => ({ season, episode, copy: plainCopy(episode) }))
        // A film's one file is titled after the film: match it like an episode.
        .filter(hit => matchKey(hit.copy.file.title).includes(want))),
    }))
    .filter(g => g.hits.length > 0)
}
