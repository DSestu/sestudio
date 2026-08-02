import { useEffect, useRef, useState } from 'react'
import type { SeasonCard } from '../api'
import { searchSeasons } from '../api'

interface Props {
  /** Called with the results and the query they belong to ('' when cleared). */
  onResults: (cards: SeasonCard[], query: string) => void
  /** Externally-driven query (e.g. clicking a browse-row card). */
  term?: string | null
}

export default function SearchBar({ onResults, term }: Props) {
  const [query, setQuery] = useState('')

  // Adopt an externally-set term (render-phase, so it lands in the same pass).
  const [prevTerm, setPrevTerm] = useState(term)
  if (term !== prevTerm) {
    setPrevTerm(term)
    if (term) setQuery(term)
  }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const onResultsRef = useRef(onResults)
  useEffect(() => { onResultsRef.current = onResults })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!query.trim()) { onResultsRef.current([], ''); return }
    timer.current = setTimeout(async () => {
      setLoading(true)
      try {
        const results = await searchSeasons(query.trim())
        setError(null)
        onResultsRef.current(results, query.trim())
      } catch {
        setError('Search failed — is the server reachable?')
        onResultsRef.current([], query.trim())
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [query])

  return (
    <div>
      <div className="relative">
        <input
          ref={inputRef}
          type="search"
          placeholder="Search series…"
          aria-label="Search series"
          value={query}
          onChange={e => { setQuery(e.target.value); setError(null) }}
          className="input input-bordered w-full text-lg"
        />
        {loading && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 loading loading-spinner loading-sm text-base-content/50" aria-label="Searching" />
        )}
      </div>
      {error && (
        <p role="alert" className="text-error text-sm mt-2">{error}</p>
      )}
    </div>
  )
}
