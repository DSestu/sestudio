import { useEffect, useState } from 'react'
import type { SeasonDetail } from '../../api'
import { getSeason } from '../../api'

/**
 * Fetch a season's detail for a page URL, with language fallback: if the
 * requested language is absent but another exists, switch to it and refetch
 * (keeping the loading state so the empty-state doesn't flash).
 */
export function useSeasonDetail(pageUrl: string, initialLang: string) {
  const [detail, setDetail] = useState<SeasonDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeLang, setActiveLang] = useState(initialLang)

  useEffect(() => {
    let cancelled = false
    getSeason(pageUrl, activeLang)
      .then(d => {
        if (cancelled) return
        if (d.available_langs.length > 0 && !d.available_langs.includes(activeLang)) {
          setActiveLang(d.available_langs[0])
          return
        }
        setDetail(d)
        setError(null)
        setLoading(false)
      })
      .catch(e => {
        if (cancelled) return
        setError(String(e))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [pageUrl, activeLang])

  return { detail, loading, error, setError, activeLang, setActiveLang }
}
