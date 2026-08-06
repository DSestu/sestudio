import { useEffect, useState } from 'react'
import type { TmdbPerson } from '../api'
import { getPerson } from '../api'
import EmptyState from '../components/EmptyState'
import PosterGrid from '../components/PosterGrid'
import SortSelect from '../components/SortSelect'
import type { Navigate } from '../nav'
import type { SortKey } from '../sortItems'
import { SORTS_FOR, defaultSortFor, sortItems } from '../sortItems'

/** Accent- and case-insensitive, so "phenix" finds "Phénix". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

interface Props {
  personId: number
  navigate: Navigate
}

interface Fetched {
  /** The person these data belong to — a stale profile is never shown. */
  id: number
  person: TmdbPerson | null
}

/**
 * An actor's / director's profile and filmography, reached by clicking a
 * credit in the title header. Filmography cards aren't playable directly —
 * clicking one searches the sources for that title.
 */
export default function PersonView({ personId, navigate }: Props) {
  const [fetched, setFetched] = useState<Fetched | null>(null)
  const [bioExpanded, setBioExpanded] = useState(false)
  // The view is keyed on the person id, so these reset with each profile.
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>(defaultSortFor('credits'))

  const current = fetched?.id === personId ? fetched : null

  useEffect(() => {
    let cancelled = false
    getPerson(personId).then(p => {
      if (!cancelled) setFetched({ id: personId, person: p })
    })
    return () => { cancelled = true }
  }, [personId])

  if (!current) {
    return (
      <div className="flex justify-center py-16" aria-busy="true" aria-label="Loading profile">
        <span className="loading loading-spinner loading-md text-base-content/40" />
      </div>
    )
  }
  const person = current.person
  if (!person) {
    return (
      <EmptyState
        title="Profile unavailable"
        message="TMDB has no data for this person, or the lookup failed."
      />
    )
  }

  const born = person.birthday && /^\d{4}/.test(person.birthday) ? person.birthday.slice(0, 4) : ''

  // Plain consts rather than memos: these sit after the early returns above,
  // where a hook could not go, and a few hundred credits are cheap to filter.
  const needle = fold(query.trim())
  const matching = needle
    ? person.credits.filter(c => fold(c.title).includes(needle) || fold(c.role).includes(needle))
    : person.credits
  const shown = sortItems(matching, sort)

  const biography = person.biography && (
    <div>
      <p className={`text-sm text-base-content/70 leading-snug whitespace-pre-line ${bioExpanded ? '' : 'line-clamp-4'}`}>
        {person.biography}
      </p>
      <button
        onClick={() => setBioExpanded(e => !e)}
        className="text-xs font-medium text-primary mt-1"
      >
        {bioExpanded ? 'Show less' : 'Read more'}
      </button>
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-4 sm:gap-6">
        <button
          onClick={() => history.back()}
          aria-label="Back"
          className="btn btn-ghost btn-sm btn-square shrink-0 mt-1"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        {person.profile_url ? (
          <img
            src={person.profile_url}
            alt=""
            className="w-24 sm:w-32 rounded-box object-cover aspect-[2/3] shrink-0"
          />
        ) : (
          <div className="w-24 sm:w-32 aspect-[2/3] rounded-box bg-base-300 shrink-0" />
        )}
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{person.name}</h1>
          <p className="text-sm text-base-content/50 mt-1">
            {[person.known_for_department, born && `Born ${born}`].filter(Boolean).join(' · ')}
          </p>
          {/* Full-width biography moves below the header row on phones. */}
          <div className="mt-3 hidden sm:block">{biography}</div>
        </div>
      </div>

      <div className="sm:hidden -mt-2">{biography}</div>

      <section aria-label="Filmography">
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <h2 className="text-base sm:text-lg font-semibold tracking-tight">
            Filmography
            {person.credits.length > 0 && (
              <span className="text-base-content/40 font-normal text-sm ml-2">
                {shown.length === person.credits.length
                  ? person.credits.length
                  : `${shown.length} of ${person.credits.length}`}
              </span>
            )}
          </h2>
          {person.credits.length > 1 && (
            <div className="flex items-center gap-2 ml-auto">
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Filter titles…"
                aria-label="Filter filmography"
                className="input input-bordered input-sm w-36 sm:w-48"
              />
              <SortSelect options={SORTS_FOR.credits} value={sort} onChange={setSort} />
            </div>
          )}
        </div>

        {person.credits.length === 0 ? (
          <p className="text-sm text-base-content/50">No credited titles.</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-base-content/50">No title matches “{query}”.</p>
        ) : (
          <PosterGrid
            items={shown.map(c => ({
              key: `${c.kind}-${c.tmdb_id}`,
              title: c.title,
              subtitle: [c.year || null, c.role || null].filter(Boolean).join(' · '),
              rating: c.rating,
              poster_url: c.poster_url,
              onClick: () => navigate('search', { q: c.title }),
            }))}
          />
        )}
      </section>
    </div>
  )
}
