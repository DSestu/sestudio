import { useEffect, useState, type ReactNode } from 'react'
import type { CatalogInfo, Shelf } from '../../api'
import { getCatalogs, getShelves, getSites } from '../../api'
import { openDiscoverMenu } from '../../discoverMenu'
import type { Navigate } from '../../nav'
import type { OpenTitle } from '../../rowItems'
import PosterStrip, { VersionChip } from './PosterStrip'
import Widget, { WidgetGrid } from './Widget'

const TMDB = 'tmdb'

interface Props {
  lang: string
  onOpen: OpenTitle
  onNavigate: Navigate
  onSearchTerm: (term: string, year?: number) => void
  onOpenCatalog: (id: string) => void
}

/** A catalogue shelf, with the catalogue it came from. `undefined` while it loads, null when absent. */
type Loaded = { catalog: CatalogInfo; shelf: Shelf } | null | undefined

const ghostBtn = 'btn btn-sm btn-ghost bg-base-content/8 font-medium'

/**
 * Home before there is anything to resume, follow or watch
 * (docs/SPEC-home-dashboard.md §5, first run): a welcome lit by trending
 * posters where Continue watching will be, two dashed tiles previewing the
 * widgets still to come, and two real shelves to start from.
 */
export default function FirstRun({ lang, onOpen, onNavigate, onSearchTerm, onOpenCatalog }: Props) {
  const [trending, setTrending] = useState<Loaded>()
  const [site, setSite] = useState<Loaded>()
  const [sites, setSites] = useState(0)

  useEffect(() => {
    let alive = true
    const shelf = (catalog: CatalogInfo | undefined, set: (v: Loaded) => void, pick: (s: Shelf[]) => Shelf | undefined) => {
      if (!catalog) { set(null); return }
      getShelves(catalog.id)
        .then(s => { const found = pick(s); if (alive) set(found?.cards.length ? { catalog, shelf: found } : null) })
        // A failed shelf is absent, not a skeleton forever.
        .catch(() => { if (alive) set(null) })
    }
    getCatalogs()
      .then(cats => {
        shelf(cats.find(c => c.id === TMDB), setTrending, s => s.find(x => x.id === 'trending') ?? s[0])
        shelf(cats.find(c => c.id !== TMDB), setSite, s => s[0])
      })
      .catch(() => { if (alive) { setTrending(null); setSite(null) } })
    getSites().then(s => { if (alive) setSites(s.filter(x => x.enabled).length) }).catch(() => {})
    return () => { alive = false }
  }, [])

  // The mosaic needs posters, TMDB's if there is a key, else the site's.
  const art = (trending ?? site)?.shelf.cards.map(c => c.poster_url).filter(Boolean) ?? []

  const shelfWidget = (loaded: Loaded, sub: (label: string) => string) => loaded !== null && (
    <Widget
      size="M"
      title={loaded?.shelf.title ?? ''}
      sub={loaded && sub(loaded.catalog.label)}
      onOpen={loaded ? () => onOpenCatalog(loaded.catalog.id) : undefined}
      loading={!loaded}
      // Discover's window: it runs off the right edge, the catalogue goes on.
      frame="f-disc rounded-r-none pr-0 mr-[calc(-1*var(--gutter))] md:col-span-full [&>h2]:mr-2"
    >
      {loaded && (
        <PosterStrip
          items={loaded.shelf.cards.slice(0, 18).map(c => ({
            key: c.key,
            title: c.title,
            poster_url: c.poster_url,
            onClick: () => c.open.card
              ? onOpen(c.open.card, 0, lang)
              : onSearchTerm(c.open.search?.term ?? c.title, c.open.search?.year || undefined),
          }))}
        />
      )}
    </Widget>
  )

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 md:grid-cols-[2fr_1fr_1fr] gap-2.5 md:gap-3">
        <section
          aria-label="Welcome"
          className="f-welcome relative isolate col-span-2 md:col-span-1 h-[330px] md:h-[264px] overflow-hidden rounded-box bg-base-200 p-3.5 md:p-[18px] flex flex-col animate-rise motion-reduce:animate-none"
        >
          {/* Trending posters, tilted, lighting the panel from behind. */}
          <div
            aria-hidden="true"
            className="absolute -z-10 -left-[12%] -right-[12%] -top-12 grid grid-cols-6 md:grid-cols-8 gap-2 -rotate-8 opacity-[.58]"
          >
            {art.length > 0 && Array.from({ length: 40 }, (_, i) => (
              <img key={i} src={art[i % art.length]} alt="" loading="lazy" className="w-full aspect-[2/3] object-cover rounded-[6px] bg-base-300" />
            ))}
          </div>
          <div aria-hidden="true" className="welcome-fade absolute inset-0 -z-10" />

          <p className="text-sm font-semibold tracking-tight">
            Continue watching <span className="font-normal text-base-content/50">· starts with your first title</span>
          </p>
          <div className="mt-auto flex flex-col gap-2">
            <h2 className="text-[25px] md:text-[28px] font-semibold tracking-tight leading-tight max-w-[300px] md:max-w-[360px]">
              What do you want to watch tonight?
            </h2>
            <p className="text-[13px] text-base-content/60 max-w-[360px]">
              One search covers {sites > 0 ? `${sites} site${sites > 1 ? 's' : ''}` : 'every site'} and every version: VF, VOSTFR or VO.
              Whatever you start waits here, ready to resume.
            </p>
            {/* The phone's search: it opens the same sheet as the dock's Search.
                Desktop already has the search bar on top of every page. */}
            <button
              type="button"
              onClick={openDiscoverMenu}
              className="md:hidden relative mt-1 flex items-center w-full h-12 pl-12 pr-4 rounded-box border-2 border-primary/80 ring-4 ring-primary/15 bg-base-100 text-base text-base-content/50 text-left"
            >
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
              </svg>
              Search a series or film
            </button>
            <button type="button" onClick={() => onNavigate('search')} className={`${ghostBtn} self-start mt-1`}>
              Browse catalogues
            </button>
          </div>
        </section>

        <GhostTile
          title="Your channels"
          line="New videos from YouTube and Twitch, and who is live."
          action="Follow"
          onClick={() => onNavigate('creators')}
          art={
            <div className="flex">
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  className={`grid place-items-center w-[38px] h-[38px] rounded-full bg-base-100 outline-[1.5px] outline-dashed ${
                    i < 2 ? 'outline-error/55 text-base-content/30' : 'outline-base-400 text-base-content/50'
                  } ${i ? '-ml-2.5' : ''}`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d={i < 2
                      ? 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'
                      : 'M12 5v14M5 12h14'} />
                  </svg>
                </span>
              ))}
            </div>
          }
        />
        <GhostTile
          title="Know when the VF lands"
          line="A watcher checks the sites and tells you here."
          action="Add a watcher"
          onClick={() => onNavigate('notifications')}
          art={
            <div className="relative w-11 h-12 flex flex-col items-center justify-center rounded-[6px] outline-1 outline-dashed outline-base-400 -outline-offset-1">
              <span className="text-[10px] uppercase text-base-content/50 leading-none">Tue</span>
              <span className="text-base font-semibold leading-tight">3</span>
              <span className="absolute -top-2 -right-4 flex rounded-full bg-base-100"><VersionChip lang="vf" /></span>
            </div>
          }
        />
      </div>

      <WidgetGrid>
        {shelfWidget(trending, label => `on ${label}`)}
        {shelfWidget(site, label => label)}
      </WidgetGrid>
    </div>
  )
}

/** A widget still to come, drawn dashed with its own shapes: one line, one action. */
function GhostTile({ title, line, action, onClick, art }: {
  title: string
  line: string
  action: string
  onClick: () => void
  art: ReactNode
}) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 min-w-0 rounded-box outline-1 outline-dashed outline-base-400 -outline-offset-1 px-3 py-3.5 md:px-4 md:py-[18px] md:h-[264px] animate-rise motion-reduce:animate-none"
    >
      <div aria-hidden="true">{art}</div>
      <div className="md:mt-auto">
        <h2 className="text-[15px] font-semibold tracking-tight leading-snug">{title}</h2>
        <p className="mt-1 text-xs text-base-content/60">{line}</p>
      </div>
      <button type="button" onClick={onClick} className={`${ghostBtn} w-full mt-auto md:mt-0`}>{action}</button>
    </section>
  )
}
