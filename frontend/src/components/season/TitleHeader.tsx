import type { TmdbMeta } from '../../api'

interface Props {
  meta: TmdbMeta | null
}

/**
 * Backdrop, synopsis and cast for a title. Renders nothing when TMDB is
 * disabled or found no match, so the season modal simply looks as it did.
 */
export default function TitleHeader({ meta }: Props) {
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
          {/* Fade into the modal so text below stays readable */}
          <div className="absolute inset-0 bg-gradient-to-t from-base-100 to-transparent" />
        </div>
      )}
      {hasBody && (
        <div className="px-4 sm:px-6 py-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {meta.rating > 0 && (
              <span className="badge badge-sm badge-primary">★ {meta.rating.toFixed(1)}</span>
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
            <p className="text-sm text-base-content/70 leading-snug line-clamp-3">
              {meta.overview}
            </p>
          )}
          {meta.cast.length > 0 && (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {meta.cast.map(c => (
                <div key={c.name} className="shrink-0 w-14 text-center">
                  {c.profile_url ? (
                    <img
                      src={c.profile_url}
                      alt=""
                      loading="lazy"
                      className="w-14 h-14 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-base-300" />
                  )}
                  <p className="text-[10px] leading-tight mt-1 truncate" title={c.name}>
                    {c.name}
                  </p>
                  {c.character && (
                    <p className="text-[10px] text-base-content/40 truncate" title={c.character}>
                      {c.character}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
