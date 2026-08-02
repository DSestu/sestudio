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
}

interface Props {
  title: string
  items: MediaRowItem[]
}

/** A horizontally scrollable poster row (Continue Watching, Next Up, …). */
export default function MediaRow({ title, items }: Props) {
  if (!items.length) return null
  return (
    <section aria-label={title}>
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
        {items.map(item => (
          <div
            key={item.key}
            className="relative w-28 sm:w-32 shrink-0 snap-start bg-base-200 border border-base-300 hover:border-primary rounded-lg overflow-hidden transition-colors"
          >
            {item.onRemove && (
              <button
                onClick={item.onRemove}
                aria-label={`Remove ${item.title} from ${title}`}
                title="Remove"
                className="absolute top-1 right-1 z-10 btn btn-xs btn-circle bg-black/60 border-none text-white hover:bg-black/90"
              >
                ✕
              </button>
            )}
            <button onClick={item.onClick} className="w-full text-left">
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
              {item.progress !== undefined && (
                <div className="h-1 bg-base-300">
                  <div
                    className="h-1 bg-primary"
                    style={{ width: `${Math.round(Math.min(1, Math.max(0, item.progress)) * 100)}%` }}
                  />
                </div>
              )}
              <div className="p-2">
                <p className="text-xs font-medium leading-tight truncate">{item.title}</p>
                {item.subtitle && (
                  <p className="text-xs text-base-content/50 mt-0.5 truncate">{item.subtitle}</p>
                )}
              </div>
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
