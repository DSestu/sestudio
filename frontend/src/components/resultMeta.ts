import type { CollectionEntry } from '../collections'
import type { SeasonCard } from '../api'

// Small bits of card presentation shared by the grid and the detail row, so the
// two layouts of one result can't describe it differently.

/** "Film", "Anime S03" or "S03" — the kind, carried by text and not colour.
 *
 *  A card standing for a whole show drops the season number, which would name
 *  only the first of the seasons it covers; seasonsLabel() says how many. */
export function kindLabel(card: SeasonCard): string {
  if (card.is_film) return 'Film'
  const collapsed = (card.seasons?.length ?? 0) > 0
  const season = `S${String(card.season_number).padStart(2, '0')}`
  if (collapsed) return card.is_anime ? 'Anime' : 'Series'
  return card.is_anime ? `Anime ${season}` : season
}

/** "5 seasons" for a card that covers a whole show, '' for anything else. */
export function seasonsLabel(card: SeasonCard): string {
  const count = 1 + (card.seasons?.length ?? 0)
  if (card.is_film || count < 2) return ''
  return `${count} seasons`
}

/** The watchlist/favourites entry a result stands for (the timestamp is set on save). */
export function saveEntry(card: SeasonCard, poster: string): Omit<CollectionEntry, 'addedAt'> {
  return {
    series: card.series_name,
    season: card.is_film ? 0 : card.season_number,
    label: card.series_name,
    poster_url: poster,
    page_url: card.page_url,
    lang: '',
    source: card.source,
  }
}
