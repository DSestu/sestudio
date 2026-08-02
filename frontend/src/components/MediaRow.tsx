import type { ReactNode } from 'react'

export interface MediaRowItem {
  key: string
  title: string
  subtitle?: string
  poster_url: string
  /** 0..1 — renders a progress bar under the poster when set. */
  progress?: number
  onClick: () => void
  /** When set, shows a ✕ control that removes the item from the row. */
  onRemove?: () => void
  /** Extra controls rendered over the card (e.g. save toggles). */
  actions?: ReactNode
}

interface Props {
  title: string
  items: MediaRowItem[]
  /** Optional "See all" affordance in the row header. */
  onSeeAll?: () => void
}

/** A horizontally scrollable poster row (Continue Watching, Next Up, …). */
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
          <div
            key={item.key}
            className="group relative w-[7.5rem] sm:w-36 lg:w-40 shrink-0 snap-start"
          >
            {item.onRemove && (
              <button
                onClick={item.onRemove}
                aria-label={`Remove ${item.title} from ${title}`}
                title="Remove"
                className="absolute top-1.5 right-1.5 z-10 btn btn-xs btn-circle bg-base-100/80 border-none text-base-content hover:bg-error hover:text-error-content opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
              >
                ✕
              </button>
            )}
            {item.actions && (
              <div className="absolute bottom-[4.25rem] right-1.5 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                {item.actions}
              </div>
            )}
            <button onClick={item.onClick} className="w-full text-left">
              <div className="relative rounded-box overflow-hidden bg-base-200 ring-1 ring-base-300 group-hover:ring-primary/70 transition">
                {item.poster_url ? (
                  <img
                    src={item.poster_url}
                    alt=""
                    loading="lazy"
                    className="w-full aspect-[2/3] object-cover"
                  />
                ) : (
                  <div className="w-full aspect-[2/3] bg-base-300 flex items-center justify-center text-base-content/30 text-3xl">
                    ?
                  </div>
                )}
                {/* Play affordance on hover — pointer-events off so the card button still owns the click */}
                <span className="pointer-events-none absolute inset-0 hidden sm:flex items-center justify-center bg-base-100/40 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="btn btn-circle btn-primary btn-sm">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  </span>
                </span>
                {item.progress !== undefined && (
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-base-100/60">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${Math.round(Math.min(1, Math.max(0, item.progress)) * 100)}%` }}
                    />
                  </div>
                )}
              </div>
              <p className="text-xs sm:text-sm font-medium leading-tight truncate mt-2">{item.title}</p>
              {item.subtitle && (
                <p className="text-xs text-base-content/50 mt-0.5 truncate">{item.subtitle}</p>
              )}
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
