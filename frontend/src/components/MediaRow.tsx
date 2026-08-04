import MediaCard, { type MediaCardItem } from './MediaCard'

interface Props {
  title: string
  items: MediaCardItem[]
  /** Optional "See all" affordance in the row header. */
  onSeeAll?: () => void
}

/** A horizontally scrollable poster row (Watchlist, Favourites, Trending…). */
export default function MediaRow({ title, items, onSeeAll }: Props) {
  if (!items.length) return null
  return (
    <section aria-label={title}>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-base sm:text-lg font-semibold tracking-tight">{title}</h2>
        {onSeeAll && (
          <button onClick={onSeeAll} className="text-xs font-medium text-base-content/50 hover:text-primary transition-colors">
            See all
          </button>
        )}
      </div>
      <div className="flex gap-3 sm:gap-4 overflow-x-auto no-scrollbar pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x">
        {items.map(item => (
          <div key={item.key} className="w-[7.5rem] sm:w-36 lg:w-40 shrink-0 snap-start">
            <MediaCard item={item} removeContext={title} />
          </div>
        ))}
      </div>
    </section>
  )
}
