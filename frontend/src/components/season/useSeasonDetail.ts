import { useEffect, useMemo, useState } from 'react'
import type { SeasonDetail } from '../../api'
import { getSeason } from '../../api'

interface Probe {
  url: string
  source: string
  detail: SeasonDetail
}

/**
 * Fetch a title's detail, across every source page it has.
 *
 * A site lists a title once per language and again per mirror, so a single
 * page rarely holds everything: one may be the only vostfr, another may carry an
 * extra provider. All of them are fetched for the active language, their
 * `available_langs` are unioned for the switcher, and the page that actually
 * serves the active language wins.
 *
 * `altSources` pairs positionally with `altPageUrls` (both flow from a merged
 * card's `alts`); a missing entry means 'fstream', matching the backend default.
 *
 * Language fallback is unchanged in spirit: when the requested language exists
 * nowhere, switch to the first that does and refetch, holding the loading state
 * so the empty state doesn't flash.
 */
export function useSeasonDetail(
  pageUrl: string,
  initialLang: string,
  altPageUrls: string[] = [],
  source = 'fstream',
  altSources: string[] = [],
) {
  const [detail, setDetail] = useState<SeasonDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeLang, setActiveLang] = useState(initialLang)
  /** Union of every source's languages — what the switcher should offer. */
  const [langs, setLangs] = useState<string[]>([])
  /** The page serving `activeLang`; what playback and downloads should record. */
  const [sourceUrl, setSourceUrl] = useState(pageUrl)
  /** The site id of that page — travels with everything the page yields. */
  const [sourceId, setSourceId] = useState(source)

  // Keyed on strings so the effect isn't retriggered by fresh array identities.
  const altKey = altPageUrls.join('|')
  const altSrcKey = altSources.join('|')
  const targets = useMemo(() => {
    const alts = altKey ? altKey.split('|') : []
    const srcs = altSrcKey ? altSrcKey.split('|') : []
    return [
      { url: pageUrl, source },
      ...alts.map((url, i) => ({ url, source: srcs[i] || 'fstream' })),
    ]
  }, [pageUrl, source, altKey, altSrcKey])

  useEffect(() => {
    let cancelled = false

    // A dead mirror shouldn't sink the others, so failures resolve to null.
    Promise.all(
      targets.map(t =>
        getSeason(t.url, activeLang, t.source).then(
          d => ({ url: t.url, source: d.source ?? t.source, detail: d }) as Probe,
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
      setSourceId(chosen.source)
      setDetail(chosen.detail)
      setError(null)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [targets, activeLang])

  return { detail, loading, error, setError, activeLang, setActiveLang, langs, sourceUrl, sourceId }
}
