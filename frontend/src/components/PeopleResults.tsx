import type { PersonHit } from '../api'

interface Props {
  people: PersonHit[]
  onOpen: (id: number) => void
}

/**
 * The People band above title results.
 *
 * A search for "tarantino" is a search for a person, not a title, so the
 * matches are offered as their own row rather than being mixed into the title
 * grid. Each card names a few of their titles, which is what tells two people
 * of the same name apart.
 */
export default function PeopleResults({ people, onOpen }: Props) {
  if (!people.length) return null

  return (
    <section aria-label="People" className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/50">
        People
      </h3>
      {/* A horizontal band, so people never push the title results off-screen. */}
      <ul className="flex gap-3 overflow-x-auto pb-1">
        {people.map(person => (
          <li key={person.id} className="shrink-0">
            <button
              onClick={() => onOpen(person.id)}
              className="w-28 text-left group"
              title={`${person.name}${person.known_for.length ? ` — ${person.known_for.join(', ')}` : ''}`}
            >
              {person.profile_url ? (
                <img
                  src={person.profile_url}
                  alt=""
                  loading="lazy"
                  className="w-28 aspect-[2/3] object-cover rounded-box bg-base-300 transition group-hover:brightness-110"
                />
              ) : (
                <div className="w-28 aspect-[2/3] rounded-box bg-base-300 flex items-center justify-center text-base-content/30 text-2xl">
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
    </section>
  )
}
