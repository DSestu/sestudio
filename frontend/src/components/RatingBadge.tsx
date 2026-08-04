interface Props {
  rating: number
  className?: string
}

/** TMDB-style traffic light: good, mixed, bad. */
function tone(rating: number): string {
  if (rating >= 7) return 'badge-success'
  if (rating >= 4) return 'badge-warning'
  return 'badge-error'
}

/**
 * A star rating chip colored by the score, so a grid can be scanned for
 * quality at a glance. Renders nothing for unrated titles.
 */
export default function RatingBadge({ rating, className = '' }: Props) {
  if (rating <= 0) return null
  return (
    <span
      className={`badge badge-sm gap-0.5 border-none font-medium ${tone(rating)} ${className}`}
      title={`TMDB rating ${rating}/10`}
    >
      ★ {rating.toFixed(1)}
    </span>
  )
}
