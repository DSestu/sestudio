import type { SeasonCard } from './api'

// The source lists the same title several times — once per language, and again
// per mirror. Those are distinct pages with distinct content (one may be the
// only vostfr, another may carry an extra provider), so they must not simply be
// deduplicated away. Instead they collapse into one result that remembers every
// page, and the detail view unions their languages.

function groupKey(card: SeasonCard): string {
  const title = card.series_name.trim().toLowerCase()
  return `${title}|${card.is_film ? 'film' : `s${card.season_number}`}`
}

/**
 * Collapse search results that describe the same title into one card each,
 * carrying the other pages in `alt_page_urls`.
 *
 * First-appearance order is preserved, so relevance ranking survives. The
 * primary is the first entry with a poster (the alternates are usually
 * poster-less mirror listings), and a year is borrowed from an alternate when
 * the primary lacks one.
 */
export function mergeCards(cards: SeasonCard[]): SeasonCard[] {
  const groups = new Map<string, SeasonCard[]>()
  for (const card of cards) {
    const key = groupKey(card)
    const group = groups.get(key)
    if (group) group.push(card)
    else groups.set(key, [card])
  }

  return [...groups.values()].map(group => {
    const primary = group.find(c => c.poster_url) ?? group[0]
    const alternates = group.filter(c => c !== primary)
    if (!alternates.length) return primary
    return {
      ...primary,
      year: primary.year || alternates.find(c => c.year)?.year,
      alt_page_urls: alternates.map(c => c.page_url),
    }
  })
}
