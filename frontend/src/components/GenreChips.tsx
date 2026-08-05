interface Props {
  /** Every genre present in the list being filtered, already sorted. */
  available: string[]
  selected: Set<string>
  onToggle: (genre: string) => void
  onClear: () => void
}

/**
 * Genre filter chips, over the genres actually present in the list.
 *
 * Deliberately not the browse panel's chips: those are TMDB's full genre list
 * for a media type, because that filter is a query the API answers. Here the
 * filter is applied to a fixed set of saved titles, so offering a genre nothing
 * in the library has would only ever empty the list.
 *
 * Selecting several narrows rather than widens — a title must carry all of them,
 * matching what the browse filter's `with_genres` does.
 */
export default function GenreChips({ available, selected, onToggle, onClear }: Props) {
  if (!available.length) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by genre">
      {available.map(genre => {
        const active = selected.has(genre)
        return (
          <button
            key={genre}
            onClick={() => onToggle(genre)}
            aria-pressed={active}
            className={`badge badge-lg cursor-pointer transition-colors ${
              active ? 'badge-primary' : 'badge-ghost hover:badge-outline'
            }`}
          >
            {genre}
          </button>
        )
      })}
      {selected.size > 0 && (
        <button onClick={onClear} className="btn btn-ghost btn-xs">
          Clear
        </button>
      )}
    </div>
  )
}
