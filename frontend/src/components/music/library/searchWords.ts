import type { MusicTrack } from '../../../musicLibrary'
import { MOOD_ORDER, type Facts } from './facts'

// One search box for names and sound words (SPEC-music-library §2.3): mood words and a tempo
// (60–200) become chips; the rest matches title, album, artist and genre.

export const BPM_TOL = 10

export interface Query {
  /** Mood words as the ladder spells them ("Dark"). */
  moods: string[]
  bpm?: number
  /** The name words, lower case. Only these go online. */
  terms: string[]
}

const MOODS = new Map(MOOD_ORDER.map(w => [w.toLowerCase(), w]))

export function parseQuery(text: string): Query {
  const q: Query = { moods: [], terms: [] }
  for (const w of text.toLowerCase().split(/\s+/).filter(Boolean)) {
    const mood = MOODS.get(w)
    if (mood) q.moods.push(mood)
    else if (/^\d{2,3}$/.test(w) && +w >= 60 && +w <= 200) q.bpm = +w
    else q.terms.push(w)
  }
  return q
}

export const isEmpty = (q: Query) => !q.moods.length && q.bpm === undefined && !q.terms.length

/** Whether a track answers every part of the query. */
export function matches(t: MusicTrack, f: Facts, q: Query): boolean {
  const x = f(t.id)
  if (q.moods.length && !q.moods.includes(x.mood?.word ?? '')) return false
  if (q.bpm !== undefined && (!x.bpm || Math.abs(x.bpm - q.bpm) > BPM_TOL)) return false
  const hay = `${t.title} ${t.album} ${t.albumName ?? ''} ${t.artist} ${x.genre ?? ''}`.toLowerCase()
  return q.terms.every(w => hay.includes(w))
}
