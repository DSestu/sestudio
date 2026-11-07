import type { TmdbMeta } from '../../api'
import type { Navigate } from '../../nav'
import RatingBadge from '../RatingBadge'

interface Props {
  meta: TmdbMeta | null
  navigate: Navigate
}

/** Whether there is anything to show for this title. WatchView asks the same to
 *  decide on its About tab. */
const hasAbout = (meta: TmdbMeta | null) =>
  !!meta && !!(meta.backdrop_url || meta.overview || meta.genres.length || meta.cast.length)

/**
 * About a title, under the watch page's player (docs/SPEC-below-player.md):
 * facts, synopsis and credits beside the first 8 cast on desktop, stacked on
 * a phone under its backdrop; then titles like it. Renders nothing when TMDB is
 * disabled or found no match. Cast and directors link to their person page;
 * similar titles run a fresh source search.
 */
export default function TitleHeader({ meta, navigate }: Props) {
  if (!meta || !hasAbout(meta)) return null
  const cast = meta.cast.slice(0, 8)

  return (
    <section aria-label={`About ${meta.title}`} className="flex flex-col gap-4">
      {meta.backdrop_url && (
        <img src={meta.backdrop_url} alt="" loading="lazy" className="lg:hidden w-full h-30 rounded-box object-cover" />
      )}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-9">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2.5">
            <RatingBadge rating={meta.rating} />
            {(meta.vote_count > 0 || meta.year > 0) && (
              <span className="text-base-content/55 text-xs tabular-nums">
                {[meta.vote_count > 0 && `${meta.vote_count.toLocaleString()} votes`, meta.year > 0 && meta.year]
                  .filter(Boolean).join(' · ')}
              </span>
            )}
            {meta.genres.slice(0, 3).map(g => (
              <span key={g} className="badge badge-sm border-none bg-base-300">{g}</span>
            ))}
          </div>
          {meta.overview && (
            <p className="text-sm lg:text-[15px] leading-relaxed text-base-content/85 max-w-[66ch]">{meta.overview}</p>
          )}
          {(meta.directors.length > 0 || meta.trailer_key) && (
            <p className="mt-2.5 text-xs text-base-content/55">
              {meta.directors.length > 0 && (
                <>
                  {meta.kind === 'tv' ? 'Created by' : 'Directed by'}{' '}
                  {meta.directors.map((d, i) => (
                    <span key={d.id}>
                      {i > 0 && ', '}
                      <button onClick={() => navigate('person', { id: d.id })} className="text-primary hover:underline underline-offset-3">
                        {d.name}
                      </button>
                    </span>
                  ))}
                </>
              )}
              {meta.directors.length > 0 && meta.trailer_key && ' · '}
              {meta.trailer_key && (
                <a
                  href={`https://www.youtube.com/watch?v=${meta.trailer_key}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline underline-offset-3"
                >
                  ▶ Trailer
                </a>
              )}
            </p>
          )}
        </div>

        {cast.length > 0 && (
          // A row that scrolls on a phone; two columns of faces beside the text on desktop.
          <ul className="flex gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-2 lg:gap-x-3.5 lg:gap-y-3 lg:overflow-visible lg:pb-0 lg:content-start">
            {cast.map(c => (
              <li key={c.id} className="shrink-0 w-16 lg:w-auto min-w-0">
                <button
                  onClick={() => navigate('person', { id: c.id })}
                  className="group w-full flex flex-col items-center gap-1.5 text-center lg:flex-row lg:gap-2.5 lg:text-left"
                  aria-label={`View ${c.name}'s profile`}
                >
                  {c.profile_url ? (
                    <img
                      src={c.profile_url}
                      alt=""
                      loading="lazy"
                      className="w-13.5 h-13.5 lg:w-10 lg:h-10 shrink-0 rounded-full object-cover ring-0 group-hover:ring-2 ring-primary transition-shadow"
                    />
                  ) : (
                    <span className="w-13.5 h-13.5 lg:w-10 lg:h-10 shrink-0 rounded-full bg-base-300" />
                  )}
                  <span className="min-w-0 w-full">
                    <span className="block truncate text-[11px] lg:text-[13px] font-medium group-hover:text-primary">{c.name}</span>
                    {c.character && <span className="block truncate text-[10px] lg:text-xs text-base-content/55">{c.character}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {meta.recommendations.length > 0 && (
        <div className="mt-2">
          <h2 className="font-semibold tracking-tight mb-2.5">More like {meta.title}</h2>
          <ul className="grid grid-cols-3 lg:grid-cols-7 gap-3">
            {meta.recommendations.slice(0, 7).map((r, i) => (
              <li key={`${r.kind}-${r.tmdb_id}`} className={i === 6 ? 'hidden lg:block' : undefined}>
                <button type="button" onClick={() => navigate('search', { q: r.title })} className="group w-full text-left">
                  <span className="relative block">
                    {r.poster_url ? (
                      <img src={r.poster_url} alt="" loading="lazy" className="w-full aspect-2/3 rounded-box object-cover bg-base-300 transition-transform duration-200 ease-smooth group-hover:-translate-y-0.5" />
                    ) : (
                      <span className="block w-full aspect-2/3 rounded-box bg-base-300" />
                    )}
                    <RatingBadge rating={r.rating} className="absolute top-1.5 right-1.5" />
                  </span>
                  <span className="mt-1.5 block truncate text-xs lg:text-[13px] group-hover:text-primary">{r.title}</span>
                  {r.year > 0 && <span className="block text-[11px] text-base-content/55">{r.year}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
