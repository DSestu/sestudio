import { kindMeta, type KindFamily } from '../watcherKinds'

/** Stroke icon per family, in the same weight as the nav rail's. */
function icon(family: KindFamily) {
  const paths: Record<KindFamily, string[]> = {
    // A screen on a stand: episodes of a series.
    series: ['M4 5h16v10H4z', 'M9 19h6'],
    // A film strip: sprocket columns either side of the frame.
    film: ['M4 5h16v14H4z', 'M8 5v14', 'M16 5v14'],
    search: ['M21 21l-4.35-4.35', 'M17 11a6 6 0 11-12 0 6 6 0 0112 0z'],
    // A funnel: filters, not a fixed title.
    criteria: ['M4 5h16l-6 7.5V19l-4-2v-4.5z'],
  }
  return (
    <svg
      className="w-3 h-3 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      {paths[family].map(d => (
        <path key={d} strokeLinecap="round" strokeLinejoin="round" d={d} />
      ))}
    </svg>
  )
}

interface Props {
  kind: string
  /** 'short' for dense timeline rows, 'full' for the watcher list. */
  length?: 'short' | 'full'
}

/**
 * What kind of watcher this is: icon, word and tone together.
 *
 * All three, deliberately — the tone alone would fail anyone who cannot separate
 * the hues, and an icon alone would need learning.
 */
export default function WatcherKindBadge({ kind, length = 'full' }: Props) {
  const meta = kindMeta(kind)
  return (
    <span className={`badge badge-sm badge-outline gap-1 ${meta.badge}`}>
      {icon(meta.family)}
      {length === 'short' ? meta.short : meta.label}
    </span>
  )
}
