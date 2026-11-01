import type { CSSProperties, ReactNode } from 'react'
import type { WidgetSize } from '../../homeOrder'

// Grid cells per size, on a 2-column phone / 4-column desktop grid of 80px rows.
// Heights add up: an S is as tall as an M and an L as two Ms, so any pairing
// side by side ends on the same line.
const SPAN: Record<WidgetSize, string> = {
  S: 'col-span-1 row-span-3',
  M: 'col-span-2 row-span-3',
  L: 'col-span-2 row-span-6',
}

/** Home's grid: widgets place themselves by size, and packing is dense so an S
 *  fills the gap another S left (docs/SPEC-home-dashboard.md §2). */
export function WidgetGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 auto-rows-[80px] grid-flow-row-dense gap-2.5 md:gap-3">
      {children}
    </div>
  )
}

interface Props {
  size: WidgetSize
  /** An S with no partner: it stretches to the full row. */
  lone?: boolean
  title: string
  /** Muted text beside the title ("Trending on TMDB"). */
  sub?: string
  /** A plain total, shown at 40%. */
  count?: number
  /** A count of new or unseen things, the only Signal Blue in the header. */
  badge?: number
  /** Drawn before the title (a heart, a ribbon). */
  icon?: ReactNode
  /** The header opens the widget's full view. */
  onOpen?: () => void
  /** The frame classes saying what is inside (spec §6), e.g. `f-continue`. */
  frame?: string
  style?: CSSProperties
  /** While the data loads: a skeleton at the widget's final size, so nothing jumps. */
  loading?: boolean
  children?: ReactNode
}

/** One widget on Home: a flat Aisle Dark panel whose header opens the full view. */
export default function Widget({
  size, lone, title, sub, count, badge, icon, onOpen, frame = '', style, loading, children,
}: Props) {
  const heading = (
    <>
      {icon}
      <span className="truncate">{title}</span>
      {sub && <span className="truncate text-xs font-normal text-base-content/50">{sub}</span>}
      {badge ? (
        <span className="shrink-0 rounded-full bg-primary px-[7px] text-[11px] leading-[18px] font-semibold text-primary-content">{badge}</span>
      ) : count ? (
        <span className="shrink-0 text-xs font-medium text-base-content/40">{count}</span>
      ) : null}
      {onOpen && (
        <svg className="ml-auto w-4 h-4 shrink-0 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      )}
    </>
  )
  const headClass = 'flex items-center gap-2 w-full h-7 px-1 text-sm font-semibold tracking-tight text-left'

  return (
    <section
      aria-label={title}
      style={style}
      className={`relative isolate flex flex-col min-w-0 overflow-hidden rounded-box bg-base-200 p-3 animate-rise motion-reduce:animate-none ${lone ? 'col-span-2 row-span-3' : SPAN[size]} ${frame}`}
    >
      <h2 className="-mx-1 -mt-1.5 mb-1.5">
        {onOpen ? (
          <button type="button" onClick={onOpen} className={`${headClass} rounded-field hover:bg-base-content/5`}>{heading}</button>
        ) : (
          <span className={headClass}>{heading}</span>
        )}
      </h2>
      {loading ? <div className="skeleton flex-1 rounded-box" /> : children}
    </section>
  )
}
