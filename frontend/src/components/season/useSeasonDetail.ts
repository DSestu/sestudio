import { useEffect, useMemo, useState } from 'react'
import type { SeasonDetail } from '../../api'
import { getSeason } from '../../api'

interface Probe {
  url: string
  detail: SeasonDetail
}

/**
 * Fetch a title's detail, across every source page it has.
 *
 * The source lists a title once per language and again per mirror, so a single
 * page rarely holds everything: one may be the only vostfr, another may carry an
 * extra provider. All of them are fetched for the active language, their
 * `available_langs` are unioned for the switcher, and the page that actually
 * serves the active language wins.
 *
 * Language fallback is unchanged in spirit: when the requested language exists
 * nowhere, switch to the first that does and refetch, holding the loading state
 * so the empty state doesn't flash.
 */
export function useSeasonDetail(pageUrl: string, initialLang: string, altPageUrls: string[] = []) {
  const [detail, setDetail] = useState<SeasonDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeLang, setActiveLang] = useState(initialLang)
  /** Union of every source's languages — what the switcher should offer. */
  const [langs, setLangs] = useState<string[]>([])
  /** The page serving `activeLang`; what playback and downloads should record. */
  const [sourceUrl, setSourceUrl] = useState(pageUrl)

  // Keyed on a string so the effect isn't retriggered by a fresh array identity.
  const altKey = altPageUrls.join('|')
  const urls = useMemo(
    () => [pageUrl, ...(altKey ? altKey.split('|') : [])],
    [pageUrl, altKey],
  )

  useEffect(() => {
    let cancelled = false

    // A dead mirror shouldn't sink the others, so failures resolve to null.
    Promise.all(
      urls.map(url =>
        getSeason(url, activeLang).then(
          d => ({ url, detail: d }) as Probe,
          () => null,
        ),
      ),
    ).then(results => {
      if (cancelled) return
      const ok = results.filter((r): r is Probe => r !== null)
      if (!ok.length) {
        setError('Could not load this title from any source.')
        setLoading(false)
        return
      }

      const union = [...new Set(ok.flatMap(r => r.detail.available_langs))]
      setLangs(union)

      const match = ok.find(r => r.detail.available_langs.includes(activeLang))
      if (!match && union.length > 0) {
        setActiveLang(union[0]) // refetches; loading stays true
        return
      }

      const chosen = match ?? ok[0]
      setSourceUrl(chosen.url)
      setDetail(chosen.detail)
      setError(null)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [urls, activeLang])

  return { detail, loading, error, setError, activeLang, setActiveLang, langs, sourceUrl }
}
