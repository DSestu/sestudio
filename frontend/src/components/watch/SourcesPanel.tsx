import ProviderChips from '../ProviderChips'
import type { ProviderStatus } from '../../providers'
import type { SourceListing } from '../../useSourceListings'

interface Props {
  listings: SourceListing[]
  /** Episode the rows describe; null for a film or before one is picked. */
  episodeNumber: number | null
  /** Languages the switcher offers, so a missing one can still be listed. */
  langs: string[]
  activeLang: string
  /** Still looking for listings on other sites. */
  loading: boolean
  /** Hosts of the row being played, in the order they were probed. */
  currentHosts: string[]
  /** Host probe results, for the row being played. */
  hostStatus: Record<string, ProviderStatus>
  activeHost: string | null
  /** Pick another host on the row being played. */
  onSelectHost: (host: string) => void
  /** Move to another site's listing, optionally in a given language. */
  onSelectSource: (listing: SourceListing, lang?: string) => void
  /** Switch language on the listing already open. */
  onSelectLang: (lang: string) => void
  /** The copy on disk, when this title has one. Shown as the first row. */
  downloaded?: {
    poster_url: string
    /** Languages the *episode on screen* is stored in. */
    langs: string[]
    /** "6 files · 4.2 GB" — what is held for the whole title. */
    summary: string
  } | null
  /** True when the video is coming from disk rather than from a site. */
  downloadedActive: boolean
  /** Play the copy on disk, switching language first when one is given. */
  onPlayDownloaded: (lang?: string) => void
  /** Go back to streaming the open listing; null until a host is ready. */
  onStream: (() => void) | null
}

/**
 * Every site this title can be played from, one row each.
 *
 * A dropdown hid the thing that actually decides where to watch: which versions
 * and which hosts each site has. Laid out as rows, a VOSTFR that only one site
 * carries is visible without opening anything — and one click plays it, since
 * the language badges are themselves the switch.
 *
 * The controls are the ones they replace: language buttons match the season
 * switcher, hosts are the same ProviderChips as before, and the start of each
 * row carries what the dropdown's entries carried — poster, site, title, year.
 */
export default function SourcesPanel({
  listings, episodeNumber, langs, activeLang, loading,
  currentHosts, hostStatus, activeHost, onSelectHost, onSelectSource, onSelectLang,
  downloaded, downloadedActive, onPlayDownloaded, onStream,
}: Props) {
  if (!listings.length && !downloaded) return null

  // Languages worth showing: whatever the switcher knows plus anything only a
  // remote listing turned out to have.
  const columns = [...new Set([...langs, ...listings.flatMap(l => l.langs)])]

  return (
    <div className="rounded-box border border-base-300 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-base-200/60">
        <p className="text-[10px] uppercase tracking-wide text-base-content/40">
          Watch this title from
        </p>
        {loading && (
          <span className="text-[10px] text-base-content/40">Checking other sites…</span>
        )}
      </div>

      <ul className="divide-y divide-base-300">
        {/* The copy on disk, as a source like any other. It leads the list
            because it is the one that always works — no host to resolve, no
            site to be up. It carries no hosts: a file is not served by one. */}
        {downloaded && (
          <li
            className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3 ${
              downloadedActive ? 'bg-primary/10' : ''
            }`}
          >
            <button
              type="button"
              disabled={downloadedActive || downloaded.langs.length === 0}
              onClick={() => onPlayDownloaded()}
              title={
                downloadedActive
                  ? 'Playing from your download'
                  : downloaded.langs.length
                    ? 'Play your downloaded copy'
                    : 'This episode is not downloaded'
              }
              className={`flex items-center gap-2 min-w-[12rem] text-left rounded px-1 py-0.5 transition-colors ${
                downloadedActive || !downloaded.langs.length
                  ? 'cursor-default'
                  : 'hover:bg-base-300 cursor-pointer'
              }`}
            >
              {downloaded.poster_url ? (
                <img
                  src={downloaded.poster_url}
                  alt=""
                  loading="lazy"
                  className="w-8 aspect-[2/3] object-cover rounded-sm shrink-0"
                />
              ) : (
                <span className="w-8 aspect-[2/3] rounded-sm bg-base-300 shrink-0" />
              )}
              <span className="min-w-0">
                <span className="block text-sm leading-tight truncate">
                  {downloadedActive && (
                    <span className="text-primary mr-1" aria-hidden="true">▶</span>
                  )}
                  Downloaded
                </span>
                <span className="block text-xs leading-tight text-base-content/50 truncate">
                  {downloadedActive ? 'Playing' : downloaded.summary}
                </span>
              </span>
            </button>

            {/* Which versions of *this episode* are on disk. Clicking one plays
                it, switching language if that is not the one on screen. */}
            <div className="flex items-center gap-1 flex-wrap">
              {columns.map(l => {
                const has = downloaded.langs.includes(l)
                const on = has && downloadedActive && l === activeLang
                return (
                  <button
                    key={l}
                    type="button"
                    disabled={!has}
                    onClick={() => onPlayDownloaded(l)}
                    aria-pressed={on}
                    title={
                      has
                        ? `Play the downloaded ${l.toUpperCase()}`
                        : `Not downloaded in ${l.toUpperCase()}`
                    }
                    className={`btn sm:btn-sm font-mono uppercase ${
                      !has
                        ? 'btn-ghost opacity-40 line-through'
                        : on
                          ? 'btn-primary'
                          : 'btn-ghost'
                    }`}
                  >
                    {l}
                  </button>
                )
              })}
            </div>

            <span className="ml-auto text-xs text-base-content/40">on disk</span>
          </li>
        )}

        {listings.map(listing => {
          // Per-episode when the site said so, else what the listing has at all
          // — a film, or a site that cannot answer per episode, still gets rows.
          const available = (episodeNumber !== null && listing.epLangs[episodeNumber])
            || (Object.keys(listing.epLangs).length ? [] : listing.langs)
          // The open row shows what was actually probed, in preference order;
          // the others show what their site lists, untested until they are used.
          const listed = episodeNumber !== null ? (listing.hosts[episodeNumber] ?? []) : []
          const hosts = listing.current && currentHosts.length ? currentHosts : listed

          // The open listing is not necessarily what is playing: a downloaded
          // copy plays from disk while this site's season stays on screen. So
          // this row offers "stream it instead" rather than claiming to be live.
          const playingHere = listing.current && !downloadedActive
          const streamFromHere = listing.current && downloadedActive

          return (
            <li
              key={`${listing.source}-${listing.page_url}`}
              className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3 ${
                playingHere ? 'bg-primary/10' : ''
              }`}
            >
              {/* Same content as the old dropdown entry: poster, site, title. */}
              <button
                type="button"
                disabled={playingHere || (streamFromHere && !onStream)}
                onClick={() => (streamFromHere ? onStream?.() : onSelectSource(listing))}
                title={
                  playingHere
                    ? 'Playing from here'
                    : streamFromHere
                      ? `Stream from ${listing.label} instead`
                      : `Play from ${listing.label}`
                }
                className={`flex items-center gap-2 min-w-[12rem] text-left rounded px-1 py-0.5 transition-colors ${
                  playingHere ? 'cursor-default' : 'hover:bg-base-300 cursor-pointer'
                }`}
              >
                {listing.poster_url ? (
                  <img
                    src={listing.poster_url}
                    alt=""
                    loading="lazy"
                    className="w-8 aspect-[2/3] object-cover rounded-sm shrink-0"
                  />
                ) : (
                  <span className="w-8 aspect-[2/3] rounded-sm bg-base-300 shrink-0" />
                )}
                <span className="min-w-0">
                  <span className="block text-sm leading-tight truncate">
                    {playingHere && (
                      <span className="text-primary mr-1" aria-hidden="true">▶</span>
                    )}
                    {listing.label}
                  </span>
                  <span className="block text-xs leading-tight text-base-content/50 truncate">
                    {playingHere
                      ? 'Playing'
                      : streamFromHere
                        ? 'Stream instead'
                        : listing.series_name}
                    {!listing.current && listing.year ? ` · ${listing.year}` : ''}
                  </span>
                </span>
              </button>

              {/* Versions, styled like the season switcher's language buttons.
                  Clicking one plays this site in that language. */}
              <div className="flex items-center gap-1 flex-wrap">
                {listing.loading ? (
                  <span className="text-xs text-base-content/40">checking…</span>
                ) : listing.failed ? (
                  <span className="text-xs text-error/70">unavailable</span>
                ) : (
                  columns.map(l => {
                    const has = available.includes(l)
                    const on = has && playingHere && l === activeLang
                    return (
                      <button
                        key={l}
                        type="button"
                        disabled={!has}
                        onClick={() =>
                          listing.current ? onSelectLang(l) : onSelectSource(listing, l)
                        }
                        aria-pressed={on}
                        title={
                          has
                            ? `Play ${listing.label} in ${l.toUpperCase()}`
                            : `${listing.label} has no ${l.toUpperCase()} here`
                        }
                        className={`btn sm:btn-sm font-mono uppercase ${
                          !has
                            ? 'btn-ghost opacity-40 line-through'
                            : on
                              ? 'btn-primary'
                              : 'btn-ghost'
                        }`}
                      >
                        {l}
                      </button>
                    )
                  })
                )}
              </div>

              {/* Hosts. The open row keeps the chips it always had, probe state
                  and all; the others list what their site offers, untested. */}
              {hosts.length > 0 && (
                <div className="ml-auto">
                  {listing.current ? (
                    <ProviderChips
                      providers={hosts}
                      active={activeHost}
                      status={hostStatus}
                      onSelect={onSelectHost}
                    />
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {hosts.map(host => (
                        <button
                          key={host}
                          type="button"
                          onClick={() => onSelectSource(listing)}
                          title={`Play ${listing.label} through ${host}`}
                          className="btn sm:btn-sm gap-1 font-mono btn-ghost"
                        >
                          {host}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
