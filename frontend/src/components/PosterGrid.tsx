import MediaCard, { type MediaCardItem } from './MediaCard'

/**
 * The MediaCard laid out as a wrapping grid for full-page listings.
 *
 * Two columns on a phone rather than three: at 320px a three-across card is
 * ~88px wide, which the always-visible touch controls would all but fill (#26).
 */
interface Props {
  items: MediaCardItem[]
  /** When set, every card selects instead of opening. */
  selection?: { keys: Set<string>; onToggle: (key: string) => void }
}

export default function PosterGrid({ items, selection }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4">
      {items.map(item => (
        <MediaCard
          key={item.key}
          item={item}
          selection={
            selection
              ? {
                  selected: selection.keys.has(item.key),
                  onToggle: () => selection.onToggle(item.key),
                }
              : undefined
          }
        />
      ))}
    </div>
  )
}
