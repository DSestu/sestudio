const VERSIONS = ['vf', 'vostfr', 'vo']
const isVersion = (lang?: string) => VERSIONS.includes(lang?.toLowerCase() ?? '')

/** The version a title is followed in (VF, VOSTFR, VO). VF gets the blue tint;
 *  anything else ("other", empty) is not a version and shows nothing. */
export function VersionChip({ lang }: { lang?: string }) {
  if (!lang || !isVersion(lang)) return null
  const vf = lang.toLowerCase() === 'vf'
  return (
    <span className={`shrink-0 rounded-full px-1.5 text-[10px] leading-4 font-semibold ${
      vf ? 'bg-primary/18 text-primary' : 'bg-base-content/12'
    }`}>
      {lang.toUpperCase()}
    </span>
  )
}

export interface StripItem {
  key: string
  title: string
  poster_url: string
  /** Shown as a chip on the poster when known. */
  lang?: string
  onClick: () => void
}

interface Props {
  items: StripItem[]
  /** Posters stand on a 1px shelf (Favourites' frame). */
  ledge?: boolean
}

/** A widget's row of posters: one-line titles, scrolled sideways, no scrollbar. */
export default function PosterStrip({ items, ledge }: Props) {
  return (
    <div className="relative [--card:96px] md:[--card:110px]">
      {ledge && <div aria-hidden="true" className="absolute -inset-x-3 top-[calc(var(--card)*1.5)] h-px bg-base-400" />}
      <div className="flex gap-2.5 overflow-x-auto no-scrollbar snap-x">
        {items.map(item => (
          <button key={item.key} type="button" onClick={item.onClick} className="group w-(--card) shrink-0 snap-start text-left">
            <div className="relative rounded-box overflow-hidden bg-base-300 ring-1 ring-base-300 group-hover:ring-primary/70 transition">
              {item.poster_url
                ? <img src={item.poster_url} alt="" loading="lazy" className="w-full aspect-[2/3] object-cover" />
                : <div className="w-full aspect-[2/3]" />}
              {isVersion(item.lang) && (
                <span className="absolute bottom-1.5 left-1.5 flex rounded-full bg-base-100/85 backdrop-blur-sm">
                  <VersionChip lang={item.lang} />
                </span>
              )}
            </div>
            <p className="mt-1.5 text-xs font-medium leading-tight truncate">{item.title}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
