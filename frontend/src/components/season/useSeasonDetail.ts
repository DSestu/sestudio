import { useEffect, useMemo, useState } from 'react'
import type { SeasonDetail } from '../../api'
import { getSeason } from '../../api'

/** Stable empty map, so consumers don't see a fresh identity every render. */
const EMPTY_LANGS: Record<number, string[]> = {}
const EMPTY_TITLES: Record<number, string> = {}

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
  /** Per-episode language availability, tagged with the pages it came from. */
  const [probe, setProbe] = useState<{
    targets: { url: string; source: string }[]
    map: Record<number, string[]>
    titles: Record<number, string>
  } | null>(null)

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

  // A season rarely carries every language for every episode — a fresh episode
  // is often vostfr-only for a while. Sites that know this say so per episode,
  // and their page already lists the ones the fetched language lacks, so no
  // extra request is needed.
  const stated = useMemo(() => {
    if (!detail) return null
    const map: Record<number, string[]> = {}
    const titles: Record<number, string> = {}
    let known = false
    for (const ep of detail.episodes) {
      titles[ep.number] = ep.title
      if (ep.langs?.length) {
        map[ep.number] = ep.langs
        known = true
      }
    }
    return known ? { map, titles } : null
  }, [detail])

  // Fallback for a site that says nothing: fetch each language across each
  // source in the background and compare the episode lists. It runs after the
  // first paint and never blocks it; failures just leave a language off.
  const langKey = langs.join('|')
  useEffect(() => {
    if (!langKey || stated) return
    let cancelled = false
    const all = langKey.split('|')

    Promise.all(
      targets.flatMap(t =>
        all.map(l =>
          getSeason(t.url, l, t.source).then(
            d => ({ lang: l, detail: d }),
            () => null,
          ),
        ),
      ),
    ).then(results => {
      if (cancelled) return
      const map: Record<number, string[]> = {}
      const titles: Record<number, string> = {}
      for (const r of results) {
        if (!r) continue
        for (const ep of r.detail.episodes) {
          // No embed means the episode is listed but not playable in that
          // language, which is not availability.
          if (!Object.keys(ep.embed_urls).length) continue
          const seen = (map[ep.number] ??= [])
          if (!seen.includes(r.lang)) seen.push(r.lang)
          // Kept so an episode missing from the active language can still be
          // listed by name rather than by number alone.
          titles[ep.number] ??= ep.title
        }
      }
      for (const nums of Object.values(map)) {
        nums.sort((a, b) => all.indexOf(a) - all.indexOf(b))
      }
      setProbe({ targets, map, titles })
    })

    return () => { cancelled = true }
  }, [targets, langKey, stated])

  // Availability belongs to one title, so a probe from the previous pages is
  // dropped rather than shown while the new one runs.
  const fresh = probe && probe.targets === targets ? probe : null
  const epLangs = stated?.map ?? (fresh ? fresh.map : EMPTY_LANGS)
  const epTitles = stated?.titles ?? (fresh ? fresh.titles : EMPTY_TITLES)

  return {
    detail, loading, error, setError, activeLang, setActiveLang, langs,
    sourceUrl, sourceId, epLangs, epTitles,
  }
}
