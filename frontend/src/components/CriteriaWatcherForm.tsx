import { useEffect, useState } from 'react'
import { getGenres, type TmdbGenre, type TmdbKind } from '../api'
import { addWatcher } from '../watchers'

const WINDOWS = [
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 3 months' },
  { value: 365, label: 'Last year' },
]

interface Props {
  /** Criteria watchers need TMDB; without a key there is nothing to filter on. */
  tmdbConfigured: boolean
}

/**
 * Create a watcher from metadata filters — "any thriller rated 7+ with 500 votes".
 *
 * Two things about this are deliberate and easy to get wrong:
 *
 * A vote floor hides brand-new releases, because a film out yesterday has almost
 * no votes. That is fine here only because the watcher re-checks its filters on
 * every poll, so a title qualifies on the day it earns the votes rather than
 * being judged once and discarded.
 *
 * And nothing is reported until a source actually carries the title, so this
 * cannot fill the timeline with things that can't be watched.
 */
export default function CriteriaWatcherForm({ tmdbConfigured }: Props) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<TmdbKind>('movie')
  const [genres, setGenres] = useState<TmdbGenre[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [minScore, setMinScore] = useState(7)
  const [minVotes, setMinVotes] = useState(100)
  const [windowDays, setWindowDays] = useState(90)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !tmdbConfigured) return
    void getGenres(kind).then(setGenres)
  }, [kind, open, tmdbConfigured])

  const label = () => {
    const names = genres.filter(g => selected.has(g.id)).map(g => g.name)
    const what = names.length ? names.join(' + ') : kind === 'movie' ? 'Films' : 'Series'
    return minScore > 0 ? `${what} ${minScore}+` : what
  }

  async function create() {
    setSaving(true)
    setError(null)
    try {
      await addWatcher({
        kind: 'tmdb_criteria',
        label: label(),
        config: {
          kind,
          genres: [...selected].join(','),
          min_score: minScore,
          max_score: 10,
          min_votes: minVotes,
          window_days: windowDays,
        },
      })
      setOpen(false)
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the watcher')
    } finally {
      setSaving(false)
    }
  }

  if (!tmdbConfigured) {
    return (
      <p className="text-xs text-base-content/50">
        Add a TMDB key in Settings to watch for new releases by genre and rating.
      </p>
    )
  }

  if (!open) {
    return (
      <button className="btn btn-sm btn-outline self-start" onClick={() => setOpen(true)}>
        Watch for new releases…
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-box border border-base-300 p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-base-content/50 flex-1">
          New release watcher
        </span>
        <button className="btn btn-xs btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-base-content/60">Type</span>
          <select
            className="select select-bordered select-sm"
            value={kind}
            onChange={e => {
              setKind(e.target.value as TmdbKind)
              // Genre ids are per media type, so a selection made for films is
              // meaningless for series.
              setSelected(new Set())
            }}
          >
            <option value="movie">Films</option>
            <option value="tv">Series</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-base-content/60">Min rating</span>
          <input
            type="number"
            min={0}
            max={10}
            step={0.5}
            className="input input-bordered input-sm w-20"
            value={minScore}
            onChange={e => setMinScore(Number(e.target.value))}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-base-content/60">Min votes</span>
          <input
            type="number"
            min={0}
            step={50}
            className="input input-bordered input-sm w-24"
            value={minVotes}
            onChange={e => setMinVotes(Number(e.target.value))}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-base-content/60">Released</span>
          <select
            className="select select-bordered select-sm"
            value={windowDays}
            onChange={e => setWindowDays(Number(e.target.value))}
          >
            {WINDOWS.map(w => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <p className="text-xs text-base-content/60 mb-1">
          Genres {selected.size > 0 && <span className="text-base-content/40">(all must match)</span>}
        </p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Genres">
          {genres.map(genre => {
            const on = selected.has(genre.id)
            return (
              <button
                key={genre.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setSelected(prev => {
                    const next = new Set(prev)
                    if (on) next.delete(genre.id)
                    else next.add(genre.id)
                    return next
                  })
                }
                className={`badge badge-sm cursor-pointer ${on ? 'badge-primary' : 'badge-ghost'}`}
              >
                {genre.name}
              </button>
            )
          })}
        </div>
      </div>

      <p className="text-xs text-base-content/50">
        Reported once a source actually carries the title, so nothing here is
        something you cannot watch. A vote floor means brand-new releases are
        reported a little later, when they have been rated.
      </p>

      {error && <p className="text-sm text-error">{error}</p>}

      <button className="btn btn-sm btn-primary self-start" disabled={saving} onClick={create}>
        {saving ? <span className="loading loading-spinner loading-xs" /> : `Watch “${label()}”`}
      </button>
    </div>
  )
}
