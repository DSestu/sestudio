import { useEffect, useState } from 'react'
import type { TmdbPerson } from '../api'
import { getPerson } from '../api'
import EmptyState from '../components/EmptyState'
import PosterGrid from '../components/PosterGrid'
import type { Navigate } from '../nav'

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
        <h2 className="text-base sm:text-lg font-semibold tracking-tight mb-3">Filmography</h2>
        {person.credits.length === 0 ? (
          <p className="text-sm text-base-content/50">No credited titles.</p>
        ) : (
          <PosterGrid
            items={person.credits.map(c => ({
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
