import type { TmdbMeta } from '../../api'
import type { Navigate } from '../../nav'
import MediaRow from '../MediaRow'
import RatingBadge from '../RatingBadge'

interface Props {
  meta: TmdbMeta | null
  navigate: Navigate
}

/**
 * Backdrop, synopsis, credits and similar titles for a title. Renders nothing
 * when TMDB is disabled or found no match, so the watch view simply looks as
 * it did. Cast and directors link to their person page; similar titles run a
 * fresh source search.
 */
export default function TitleHeader({ meta, navigate }: Props) {
  if (!meta) return null
  const hasBody = meta.overview || meta.genres.length > 0 || meta.cast.length > 0
  if (!meta.backdrop_url && !hasBody) return null

  return (
    <div className="border-b border-base-300">
      {meta.backdrop_url && (
        <div className="relative">
          <img
            src={meta.backdrop_url}
            alt=""
            loading="lazy"
            className="w-full h-28 sm:h-40 object-cover"
          />
          {/* Fade into the page so text below stays readable */}
          <div className="absolute inset-0 bg-gradient-to-t from-base-100 to-transparent" />
        </div>
      )}
      {hasBody && (
        <div className="px-4 sm:px-6 py-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <RatingBadge rating={meta.rating} />
            {meta.vote_count > 0 && (
              <span className="text-base-content/40 text-xs">
                {meta.vote_count.toLocaleString()} votes
              </span>
            )}
            {meta.year > 0 && (
              <span className="text-base-content/50 text-xs font-mono">{meta.year}</span>
            )}
            {meta.genres.slice(0, 3).map(g => (
              <span key={g} className="badge badge-ghost badge-sm">{g}</span>
            ))}
            {meta.trailer_key && (
              <a
                href={`https://www.youtube.com/watch?v=${meta.trailer_key}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-xs btn-ghost text-primary"
              >
                ▶ Trailer
              </a>
            )}
          </div>
          {meta.overview && (
            <p className="text-sm text-base-content/70 leading-snug">
              {meta.overview}
            </p>
          )}
          {meta.directors.length > 0 && (
            <p className="text-xs text-base-content/50">
              {meta.kind === 'tv' ? 'Created by' : 'Directed by'}{' '}
              {meta.directors.map((d, i) => (
                <span key={d.id}>
                  {i > 0 && ', '}
                  <button
                    onClick={() => navigate('person', { id: d.id })}
                    className="text-primary hover:underline"
                  >
                    {d.name}
                  </button>
                </span>
              ))}
            </p>
          )}
          {meta.cast.length > 0 && (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {meta.cast.map(c => (
                <button
                  key={c.id}
                  onClick={() => navigate('person', { id: c.id })}
                  className="shrink-0 w-14 text-center group"
                  aria-label={`View ${c.name}'s profile`}
                >
                  {c.profile_url ? (
                    <img
                      src={c.profile_url}
                      alt=""
                      loading="lazy"
                      className="w-14 h-14 rounded-full object-cover ring-0 group-hover:ring-2 ring-primary transition-shadow"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-base-300" />
                  )}
                  <p className="text-[10px] leading-tight mt-1 truncate group-hover:text-primary" title={c.name}>
                    {c.name}
                  </p>
                  {c.character && (
                    <p className="text-[10px] text-base-content/40 truncate" title={c.character}>
                      {c.character}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
          {meta.recommendations.length > 0 && (
            <div className="pt-1">
              <MediaRow
                title="Similar titles"
                items={meta.recommendations.map(r => ({
                  key: `${r.kind}-${r.tmdb_id}`,
                  title: r.title,
                  subtitle: r.year ? String(r.year) : undefined,
                  rating: r.rating,
                  poster_url: r.poster_url,
                  onClick: () => navigate('search', { q: r.title }),
                }))}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
