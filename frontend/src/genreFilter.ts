/**
 * Whether a title passes a genre selection.
 *
 * Narrowing, not widening: the title must carry *every* selected genre, matching
 * what the browse filter's `with_genres` does. An empty selection filters
 * nothing, and a title TMDB could not match has no genres to test — so it cannot
 * satisfy a non-empty selection rather than being let through by default.
 */
export function matchesAllGenres(
  genres: string[] | undefined,
  selected: Set<string>,
): boolean {
  if (!selected.size) return true
  if (!genres) return false
  return [...selected].every(pick => genres.includes(pick))
}
