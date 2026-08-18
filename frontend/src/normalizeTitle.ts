/**
 * Lower-cased and stripped of diacritics, for matching a typed query against a
 * title.
 *
 * Accent-insensitive on purpose: the catalogue is French, so "tenebres" has to
 * find "Ténèbres" — nobody reaches for the diacritics mid-search.
 */
export function normalizeTitle(text: string): string {
  return text.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}
