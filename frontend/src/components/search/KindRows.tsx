import type { SeasonCard } from '../../api'
import { KINDS, matchesKind, type Kind } from '../../titleSearch'
import { SeeAllButton } from '../MediaRow'
import ResultsGrid from '../ResultsGrid'

interface Props {
  cards: SeasonCard[]
  checkedIds: Set<string>
  onToggle: (newsid: string) => void
  onOpenDetail: (card: SeasonCard) => void
  enrich: boolean
  posters: boolean
  onDisk: ReadonlySet<string>
  /** "See all": show just this kind, as the full grid. */
  onSeeAll: (kind: Kind) => void
}

/** How many a row shows before "See all" is the way to the rest. */
const ROW_MAX = 12

/**
 * Everything a search found, one sideways-scrolling row per kind (Films,
 * Series, Anime), so a mixed result reads by kind instead of as one long grid.
 */
export default function KindRows({ cards, onSeeAll, ...grid }: Props) {
  const rows = KINDS.filter(k => k.value !== 'all')
    .map(k => ({ ...k, cards: cards.filter(c => matchesKind(c, k.value)) }))
    .filter(r => r.cards.length > 0)

  return (
    <div className="flex flex-col gap-6">
      {rows.map(r => (
        <section key={r.value} aria-label={r.label} className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-base sm:text-lg font-semibold tracking-tight">{r.label}</h3>
            <SeeAllButton onClick={() => onSeeAll(r.value)} count={r.cards.length} />
          </div>
          <ResultsGrid row cards={r.cards.slice(0, ROW_MAX)} {...grid} />
        </section>
      ))}
    </div>
  )
}
