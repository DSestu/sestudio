import { useEffect, useState } from 'react'
import { getPerson, type PersonHit, type TmdbCredit } from '../../api'
import { normalizeTitle } from '../../normalizeTitle'

interface Props {
  person: PersonHit
  onOpen: (id: number) => void
  /** Search the sources for one of their titles. */
  onSearchTerm: (term: string, year?: number) => void
}

/** What they're known for, as posters: the titles TMDB names first, then
 *  their best-rated others. */
function knownFor(credits: TmdbCredit[], names: string[]): TmdbCredit[] {
  const named = new Set(names.map(normalizeTitle))
  const withPoster = credits.filter(c => c.poster_url)
  const seen = new Set<number>()
  return [
    ...withPoster.filter(c => named.has(normalizeTitle(c.title))),
    ...[...withPoster].sort((a, b) => b.rating - a.rating),
  ].filter(c => !seen.has(c.tmdb_id) && seen.add(c.tmdb_id)).slice(0, 10)
}

/**
 * A person in the hero slot, when the search names someone rather than a
 * title ("villeneuve"): photo, what they do, and the titles they're known for,
 * each a search away.
 */
export default function PersonHero({ person, onOpen, onSearchTerm }: Props) {
  const [credits, setCredits] = useState<{ id: number; list: TmdbCredit[] }>({ id: 0, list: [] })
  useEffect(() => {
    let cancelled = false
    void getPerson(person.id).then(p => { if (!cancelled && p) setCredits({ id: person.id, list: p.credits }) })
    return () => { cancelled = true }
  }, [person.id])
  const posters = credits.id === person.id ? knownFor(credits.list, person.known_for) : []

  return (
    <section
      aria-label={`Top match: ${person.name}`}
      className="relative overflow-hidden rounded-box border border-base-300 bg-base-200 animate-rise motion-reduce:animate-none"
    >
      <img src={person.profile_url} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-2xl" />
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-base-100 via-base-100/70 to-base-100/20" />
      <div className="relative flex flex-col gap-4 p-4 sm:p-6">
        <div className="flex gap-4 sm:gap-6">
          <button type="button" onClick={() => onOpen(person.id)} className="w-24 sm:w-32 shrink-0 self-start overflow-hidden rounded-box ring-1 ring-base-300 hover:ring-primary transition">
            <img src={person.profile_url} alt="" className="w-full aspect-[2/3] object-cover" />
          </button>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-base-content/60">Person</span>
            <h2 className="text-2xl sm:text-3xl font-bold leading-tight">{person.name}</h2>
            <p className="text-sm text-base-content/70">
              {[person.known_for_department, person.known_for.length ? `Known for ${person.known_for.join(', ')}` : ''].filter(Boolean).join(' · ')}
            </p>
            <div className="mt-auto pt-1">
              <button type="button" onClick={() => onOpen(person.id)} className="btn btn-primary btn-sm">Filmography ›</button>
            </div>
          </div>
        </div>
        {posters.length > 0 && (
          <ul aria-label={`Known for`} className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {posters.map(c => (
              <li key={c.tmdb_id} className="w-24 shrink-0 animate-rise motion-reduce:animate-none">
                <button type="button" onClick={() => onSearchTerm(c.title, c.year || undefined)} className="group w-full text-left" title={`Search ${c.title}`}>
                  <img src={c.poster_url} alt="" loading="lazy" className="w-full aspect-[2/3] rounded-box object-cover ring-1 ring-base-300 transition group-hover:ring-primary" />
                  <p className="mt-1 truncate text-xs">{c.title}</p>
                  {c.year > 0 && <p className="text-[11px] font-mono text-base-content/40">{c.year}</p>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
