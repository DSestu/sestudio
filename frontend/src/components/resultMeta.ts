import type { CollectionEntry } from '../collections'
import type { SeasonCard } from '../api'

// Small bits of card presentation shared by the grid and the detail row, so the
// two layouts of one result can't describe it differently.

/** "Film", "Anime S03" or "S03" — the kind, carried by text and not colour. */
export function kindLabel(card: SeasonCard): string {
  if (card.is_film) return 'Film'
  const season = `S${String(card.season_number).padStart(2, '0')}`
  return card.is_anime ? `Anime ${season}` : season
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
  }
}
