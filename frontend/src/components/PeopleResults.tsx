import { useId, useState } from 'react'
import type { PersonHit } from '../api'

interface Props {
  people: PersonHit[]
  onOpen: (id: number) => void
  /** The People kind's page: a grid, like titles. Otherwise a sideways band. */
  grid?: boolean
}

/**
 * People named like the search.
 *
 * A search for "tarantino" is a search for a person, not a title, so the
 * matches are offered on their own rather than mixed into the title grid.
 * Each card names a few of their titles, which is what tells two people of
 * the same name apart.
 */
export default function PeopleResults({ people, onOpen, grid = false }: Props) {
  return (
    <ul
      aria-label="People"
      className={grid
        ? 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4'
        // A horizontal band, so people never push the title results off-screen.
        : 'flex gap-3 overflow-x-auto pb-1'}
    >
      {people.map(person => (
        <li key={person.id} className={grid ? 'min-w-0' : 'shrink-0 w-28'}>
          <button
            type="button"
            onClick={() => onOpen(person.id)}
            className="w-full text-left group"
            title={`${person.name}${person.known_for.length ? ` — ${person.known_for.join(', ')}` : ''}`}
          >
            {person.profile_url ? (
              <img
                src={person.profile_url}
                alt=""
                loading="lazy"
                className="w-full aspect-[2/3] object-cover rounded-box bg-base-300 transition group-hover:brightness-110"
              />
            ) : (
              <div className="w-full aspect-[2/3] rounded-box bg-base-300 flex items-center justify-center text-base-content/30 text-2xl">
                {person.name.slice(0, 1)}
              </div>
            )}
            <p className="text-sm mt-1 leading-tight line-clamp-2">{person.name}</p>
            <p className="text-[11px] text-base-content/50 leading-tight line-clamp-2">
              {person.known_for.join(' · ') || person.known_for_department}
            </p>
          </button>
        </li>
      ))}
    </ul>
  )
}

const OPEN_KEY = 'sestudio.search.peopleOpen'

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}

interface FoldProps {
  people: PersonHit[]
  /** "People" unless the hero is one of them. */
  title?: string
  status: 'loading' | 'failed' | 'done'
  onRetry: () => void
  onOpen: (id: number) => void
}

/**
 * People under Everything's title rows: folded to one line by default, since
 * titles are what a search is for. Unfolding is remembered for later searches.
 */
export function PeopleFold({ people, title = 'People', status, onRetry, onOpen }: FoldProps) {
  const [open, setOpen] = useState(readOpen)
  const bandId = useId()
  if (status === 'done' && !people.length) return null

  const heading = <span className="text-xs font-semibold uppercase tracking-wide text-base-content/50 shrink-0">{title}</span>

  if (status === 'loading') {
    return (
      <div aria-busy="true" aria-label="Loading people" className="flex items-center gap-3 border-t border-base-300 pt-3">
        {heading}
        <span className="flex">
          {[0, 1, 2].map(i => (
            <span key={i} className="w-7 h-7 -ml-2 first:ml-0 rounded-full bg-base-300 ring-2 ring-base-100 animate-pulse motion-reduce:animate-none" />
          ))}
        </span>
        <span className="h-2.5 w-32 rounded bg-base-300 animate-pulse motion-reduce:animate-none" />
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div className="flex items-center gap-3 border-t border-base-300 pt-3 text-sm">
        {heading}
        <span className="text-error">Couldn't load</span>
        <button type="button" onClick={onRetry} className="ml-auto text-primary hover:underline">Retry ↻</button>
      </div>
    )
  }

  function toggle() {
    setOpen(o => {
      try {
        localStorage.setItem(OPEN_KEY, o ? '0' : '1')
      } catch {
        // ignore
      }
      return !o
    })
  }

  return (
    <section aria-label={title} className="flex flex-col border-t border-base-300 pt-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={bandId}
        className="flex items-center gap-3 text-left rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
      >
        {heading}
        {!open && (
          <>
            <span className="flex shrink-0" aria-hidden="true">
              {people.slice(0, 4).map(p => (
                <img key={p.id} src={p.profile_url ?? ''} alt="" className="w-7 h-7 -ml-2 first:ml-0 rounded-full object-cover object-top ring-2 ring-base-100 bg-base-300" />
              ))}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-base-content/65">{people.slice(0, 4).map(p => p.name).join(', ')}{people.length > 4 ? '…' : ''}</span>
          </>
        )}
        <span className="ml-auto shrink-0 flex items-center gap-1 text-sm text-primary">
          {open ? 'Hide' : <>Show {people.length}<span className="sr-only"> people</span></>}
          <svg className={`w-3.5 h-3.5 transition-transform duration-[240ms] ease-smooth motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>
      <div
        id={bandId}
        className={`grid transition-[grid-template-rows] duration-[240ms] ease-smooth motion-reduce:transition-none ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="pt-3"><PeopleResults people={people} onOpen={onOpen} /></div>
        </div>
      </div>
    </section>
  )
}
