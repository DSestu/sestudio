import MediaCard, { type MediaCardItem } from './MediaCard'

interface Props {
  title: string
  items: MediaCardItem[]
  /** Optional "See all" affordance in the row header. */
  onSeeAll?: () => void
}

/** A row's way to the rest of it: a tinted pill beside the row title, with the
 *  total when it is known. Shared by every poster row so they read the same. */
export function SeeAllButton({ onClick, count }: { onClick: () => void; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn btn-sm rounded-full gap-1.5 bg-primary/15 text-primary border-primary/40 hover:bg-primary/25"
    >
      See all{count !== undefined && ` ${count}`}
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
    </button>
  )
}

/** A horizontally scrollable poster row (Watchlist, Favourites, Trending…). */
export default function MediaRow({ title, items, onSeeAll }: Props) {
  if (!items.length) return null
  return (
    <section aria-label={title}>
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-base sm:text-lg font-semibold tracking-tight">{title}</h2>
        {onSeeAll && <SeeAllButton onClick={onSeeAll} />}
      </div>
      {/* The right edge fades out to say the row goes on. */}
      <div className="flex gap-3 sm:gap-4 overflow-x-auto no-scrollbar mask-[linear-gradient(to_right,#000_calc(100%-8rem),transparent)] pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x">
        {items.map(item => (
          <div key={item.key} className="w-[7.5rem] sm:w-36 lg:w-40 shrink-0 snap-start">
            <MediaCard item={item} removeContext={title} />
          </div>
        ))}
      </div>
    </section>
  )
}
