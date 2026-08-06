import type { SeasonCard } from './api'

// The source lists the same title several times — once per language, and again
// per mirror. Those are distinct pages with distinct content (one may be the
// only vostfr, another may carry an extra provider), so they must not simply be
// deduplicated away. Instead they collapse into one result that remembers every
// page, and the detail view unions their languages.
//
// The hazard is the opposite error: unrelated titles that merely share a name —
// remakes, reboots, and two shows both called "Reborn" — collapsing into one
// card, which hides one of them entirely. Three signals separate them, in
// descending order of trust: the release year, the poster image, and (opt-in)
// the TMDB id.

/** Series name, kind and site — the coarse key every card falls back to.
 *  Scoped per source site so same-name titles on two sites never merge by
 *  accident; cross-site merging happens only through a shared TMDB id. */
export function titleKey(card: SeasonCard): string {
  const title = card.series_name.trim().toLowerCase()
  const kind = card.is_anime ? 'anime' : 'live'
  return `${title}|${kind}|${card.source ?? 'fstream'}`
}

/**
 * Group key for a card, with the season/film discriminator always applied.
 *
 * A TMDB id replaces the *title* half only: a TV id names the series, not the
 * season, so keying on it alone would fold every season of a show together.
 */
function groupKey(card: SeasonCard, tmdbId?: number): string {
  const identity = tmdbId ? `tmdb:${tmdbId}` : titleKey(card)
  return `${identity}|${card.is_film ? 'film' : `s${card.season_number}`}`
}

/**
 * Split a same-name group by release year.
 *
 * A single known year (the common case: one real listing plus poster-less
 * mirrors) leaves the group intact. Two or more mean a remake is in there, and
 * then year-less cards become their own cluster rather than being attached to
 * an arbitrary one — guessing which remake a yearless mirror belongs to would
 * silently bury the other.
 */
function splitByYear(group: SeasonCard[]): SeasonCard[][] {
  const known = new Set(group.map(c => c.year || 0).filter(y => y > 0))
  if (known.size <= 1) return [group]

  const clusters = new Map<number, SeasonCard[]>()
  for (const card of group) {
    const year = card.year || 0
    const cluster = clusters.get(year)
    if (cluster) cluster.push(card)
    else clusters.set(year, [card])
  }
  return [...clusters.values()]
}

/**
 * The poster's filename, which mirrors of one title share even when they serve
 * it from different hosts. Comparing whole URLs would split real mirrors apart.
 */
function posterId(card: SeasonCard): string {
  const url = card.poster_url.trim()
  if (!url) return ''
  return url.split(/[?#]/)[0].split('/').pop()?.toLowerCase() ?? ''
}

/**
 * Split a year-less cluster by poster image.
 *
 * Only ever applied where the year said nothing, so it cannot overrule the
 * stronger signal. Mirror listings are usually poster-less, so two *different*
 * posters under one name is real evidence of two titles; poster-less cards stay
 * with the first cluster, since they have nothing to place them by.
 */
function splitByPoster(cluster: SeasonCard[]): SeasonCard[][] {
  if (cluster.some(c => (c.year || 0) > 0)) return [cluster]
  const ids = new Set(cluster.map(posterId).filter(Boolean))
  if (ids.size <= 1) return [cluster]

  const clusters = new Map<string, SeasonCard[]>()
  for (const card of cluster) {
    const id = posterId(card)
    if (!id) continue
    const existing = clusters.get(id)
    if (existing) existing.push(card)
    else clusters.set(id, [card])
  }
  const groups = [...clusters.values()]
  // Nothing identifies these, so they join the first (highest-ranked) cluster.
  for (const card of cluster.filter(c => !posterId(c))) groups[0].push(card)
  return groups
}

function collapse(group: SeasonCard[], preferredSource?: string): SeasonCard {
  // The preferred site wins the card outright, so opening a merged result
  // plays from the site you chose rather than whichever listing sorted first.
  const primary =
    (preferredSource && group.find(c => (c.source ?? 'fstream') === preferredSource)) ||
    group.find(c => c.poster_url) ||
    group[0]
  const alternates = group.filter(c => c !== primary)
  if (!alternates.length) return primary
  return {
    ...primary,
    year: primary.year || alternates.find(c => c.year)?.year,
    alt_page_urls: alternates.map(c => c.page_url),
    alts: alternates,
  }
}

/**
 * Collapse search results that describe the same title into one card each,
 * carrying the other pages in `alt_page_urls` (and, whole, in `alts`).
 *
 * First-appearance order is preserved, so relevance ranking survives. The
 * primary is the first entry with a poster (the alternates are usually
 * poster-less mirror listings), and a year is borrowed from an alternate when
 * the primary lacks one.
 *
 * `tmdbIds` maps a card's newsid to its resolved TMDB id, which then stands in
 * for the title as that card's identity — this catches spelling variants of one
 * title that the string key misses. Cards with no resolved id fall back to the
 * title, so a partial map is fine and merging need not wait on the lookups.
 */
export function mergeCards(
  cards: SeasonCard[],
  tmdbIds?: Map<string, number>,
  preferredSource?: string,
): SeasonCard[] {
  const groups = new Map<string, SeasonCard[]>()
  for (const card of cards) {
    const key = groupKey(card, tmdbIds?.get(card.newsid))
    const group = groups.get(key)
    if (group) group.push(card)
    else groups.set(key, [card])
  }

  return [...groups.values()]
    .flatMap(group => splitByYear(group).flatMap(splitByPoster))
    .map(group => collapse(group, preferredSource))
}
