import type { CSSProperties } from 'react'
import type { ForYouGroup, ForYouItem } from '../../api'
import type { OpenTitle } from '../../rowItems'
import { VersionChip } from './PosterStrip'
import Widget from './Widget'

/** Posters shown: the pick and two rows beside it on desktop. */
const LIMIT = 7

interface Props {
  group: ForYouGroup
  lang: string
  onOpen: OpenTitle
  /** Discover, for more like these. */
  onSeeAll: () => void
  style?: CSSProperties
}

const posterOf = (item: ForYouItem) => item.poster_url || item.card.poster_url

/** For you (L): titles like one recently watched, lit by the top pick's own
 *  poster spotlighting the corner (docs/SPEC-home-dashboard.md §6). */
export default function ForYouWidget({ group, lang, onOpen, onSeeAll, style }: Props) {
  const items = group.items.slice(0, LIMIT)
  const art = posterOf(items[0])

  return (
    <Widget
      size="L"
      title="For you"
      sub={`Because you watched ${group.because.title}`}
      onOpen={onSeeAll}
      frame="f-foryou"
      style={{ ...style, ...(art && { '--art': `url("${art}")` }) } as CSSProperties}
    >
      <div className="grid grid-cols-[1.6fr_1fr_1fr] md:grid-cols-[1.6fr_1fr_1fr_1fr] gap-2.5">
        {items.map((item, i) => {
          const version = item.versions.includes('vf') ? 'vf' : item.versions[0]
          return (
            <button
              key={`${item.kind}-${item.tmdb_id}`}
              type="button"
              onClick={() => onOpen(item.card, 0, lang)}
              // Phones fit the pick and two rows of two.
              className={`group flex flex-col min-w-0 text-left ${i === 0 ? 'row-span-2' : ''} ${i >= 5 ? 'max-md:hidden' : ''}`}
            >
              {/* The pick fills its two rows; the rest keep the poster's 2:3. */}
              <div className={`relative rounded-box overflow-hidden bg-base-300 ring-1 ring-base-300 group-hover:ring-primary/70 transition ${i === 0 ? 'flex-1 min-h-0' : 'aspect-[2/3]'}`}>
                {posterOf(item) && <img src={posterOf(item)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />}
                {version && (
                  <span className="absolute bottom-1.5 left-1.5 flex rounded-full bg-base-100/85 backdrop-blur-sm">
                    <VersionChip lang={version} />
                  </span>
                )}
              </div>
              <p className={`mt-1.5 leading-tight truncate ${i === 0 ? 'text-sm font-semibold' : 'text-xs font-medium'}`}>{item.title}</p>
            </button>
          )
        })}
      </div>
    </Widget>
  )
}
