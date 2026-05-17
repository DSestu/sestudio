import { useEffect, useRef, useState } from 'react'
import type { SeasonCard } from '../api'
import { searchSeasons } from '../api'

interface Props {
  onResults: (cards: SeasonCard[]) => void
}

export default function SearchBar({ onResults }: Props) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!query.trim()) { onResults([]); return }
    timer.current = setTimeout(async () => {
      setLoading(true)
      try {
        const results = await searchSeasons(query.trim())
        onResults(results)
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [query])

  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Search series…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-4 py-3 text-white text-lg placeholder-zinc-500 focus:outline-none focus:border-violet-500"
      />
      {loading && (
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">
          …
        </span>
      )}
    </div>
  )
}
