import type { SeasonCard } from './api'
import { normalizeTitle } from './normalizeTitle'

// Which result, if any, is clearly the one a search was after, so the page can
// show it big with Play next to it. Better no hero than a wrong one: anything
// short of a clear winner returns null and the page starts with its rows.

const ARTICLES = /^(?:the|a|an|le|la|les|l|un|une|des)\s+/

/** A title reduced to what has to match: no accents, case, punctuation or
 *  leading article, so "Le Seigneur des anneaux" and "seigneur des anneaux"
 *  are the same title. */
export function matchKey(text: string): string {
  return normalizeTitle(text)
    .replace(/['’`]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(ARTICLES, '')
}

const YEAR = /\b(19\d{2}|20\d{2})\b/

/** "dune 1984" → { title: "dune", year: 1984 }. */
export function splitYear(query: string): { title: string; year: number } {
  const m = query.match(YEAR)
  if (!m) return { title: query, year: 0 }
  return { title: query.replace(m[0], ' ').replace(/\s+/g, ' ').trim(), year: Number(m[1]) }
}

export interface TopMatchInput {
  /** The results as shown (kind, dates and sources already applied). */
  cards: SeasonCard[]
  query: string
  /** TMDB vote count and year per card key (`newsid`), when known. */
  votes: Map<string, number>
  years: Map<string, number>
  /** Match keys of titles that are on disk, and of titles being watched. */
  onDisk: Set<string>
  watching: Set<string>
}

/** How many times the runner-up's votes the leader needs to be a clear winner. */
export const VOTE_LEAD = 3

export function pickTopMatch({ cards, query, votes, years, onDisk, watching }: TopMatchInput): SeasonCard | null {
  const { title, year } = splitYear(query)
  const want = matchKey(title)
  if (!want) return null
  let exact = cards.filter(c => matchKey(c.series_name) === want)
  // A year in the query decides between remakes.
  if (year) exact = exact.filter(c => (years.get(c.newsid) || c.year || 0) === year)
  if (!exact.length) return null
  if (exact.length === 1) return exact[0]

  const v = (c: SeasonCard) => votes.get(c.newsid) ?? 0
  const byVotes = (list: SeasonCard[]) => [...list].sort((a, b) => v(b) - v(a))

  const [first, second] = byVotes(exact)
  // A title you are watching or already have is the one you meant; on disk and
  // in watch state it is known by name only, so it can't tell remakes apart,
  // and the most-voted version stands in without needing a clear lead.
  if (watching.has(want) || onDisk.has(want)) return first
  return v(first) > 0 && v(first) >= VOTE_LEAD * v(second) ? first : null
}
