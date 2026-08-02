import type { MediaRowItem } from './MediaRow'

/** The MediaRow card, laid out as a wrapping grid for full-page listings. */
export default function PosterGrid({ items }: { items: MediaRowItem[] }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4">
      {items.map(item => (
        <div key={item.key} className="group relative">
          {item.onRemove && (
            <button
              onClick={item.onRemove}
              aria-label={`Remove ${item.title}`}
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
                <img src={item.poster_url} alt="" loading="lazy" className="w-full aspect-[2/3] object-cover" />
              ) : (
                <div className="w-full aspect-[2/3] bg-base-300 flex items-center justify-center text-base-content/30 text-3xl">?</div>
              )}
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
  )
}
