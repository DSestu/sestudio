import { useEffect, useMemo, useRef, useState } from 'react'
import type { SeasonCard, SiteInfo } from './api'
import { getSites, searchSeasons } from './api'
import { lookupTmdb } from './useTmdb'

/** One place a title can be watched from. */
export interface AlternateSource {
  /** Content site id; '' is never used — missing sources default to fstream. */
  source: string
  /** The site's human name, e.g. "Senpai Stream". */
  label: string
  page_url: string
  series_name: string
  poster_url: string
  year: number
  /** True for the source currently being watched. */
  current: boolean
}

/** Site display names, fetched once per session. */
let sitesPromise: Promise<SiteInfo[]> | null = null
function sites(): Promise<SiteInfo[]> {
  sitesPromise ??= getSites().catch(() => [])
  return sitesPromise
}

/**
 * Accent- and punctuation-insensitive title key.
 *
 * Sites disagree on more than wording: the same film arrives as "…la mort - 1ère
 * partie" from one and with a non-breaking space and a backslash-escaped
 * apostrophe from another. Dropping everything but letters and digits makes
 * those spellings compare equal.
 */
export function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

interface Params {
  seriesName: string
  season: number
  isFilm: boolean
  source: string
  pageUrl: string
  /** TMDB id of the open title, when known — the reliable cross-site identity. */
  tmdbId?: number
  /** Pages search already folded into this card; known-good without a lookup. */
  merged: { page_url: string; source: string; series_name: string; poster_url: string; year: number }[]
}

/**
 * Everywhere the open title can be watched from.
 *
 * Search only merges listings across sites when TMDB merge is on *and* the ids
 * agree, so the pages already on the card are usually just its own site's. To
 * make switching useful the other sites are queried on demand — gated behind
 * `active` so opening a title costs nothing until the switcher is opened.
 *
 * A candidate counts as the same title when the TMDB ids match; without ids
 * (no key configured, or no match) it falls back to comparing normalised names.
 * Seasons must line up too, so season 2 never silently switches to season 1.
 */
export function useAlternateSources({
  seriesName, season, isFilm, source, pageUrl, tmdbId, merged,
}: Params): {
  sources: AlternateSource[]
  loading: boolean
  /** Kick off the cross-site lookup; safe to call repeatedly. */
  ensureLoaded: () => void
} {
  const [labels, setLabels] = useState<Map<string, string>>(new Map())
  // Findings and in-progress state are tagged with the title they belong to, so
  // opening a different title simply stops matching and reads as empty — no
  // resetting, and a stale list can never be shown against the wrong title.
  const [result, setResult] = useState<{ identity: string; cards: SeasonCard[] }>(
    () => ({ identity: '', cards: [] }),
  )
  const [loadingFor, setLoadingFor] = useState('')
  // The title whose lookup finished, so reopening the switcher is free while
  // opening a different one looks again. Recorded on completion rather than on
  // start: a lookup abandoned midway must be retried, not remembered as done.
  const loadedFor = useRef<string>('')
  const inflightFor = useRef<string>('')

  useEffect(() => {
    void sites().then(list => setLabels(new Map(list.map(s => [s.id, s.display_name]))))
  }, [])

  const identity = `${source}|${pageUrl}|${season}`
  const loading = loadingFor === identity

  function ensureLoaded() {
    const wantedIdentity = identity
    if (!seriesName) return
    if (loadedFor.current === wantedIdentity) return
    if (inflightFor.current === wantedIdentity) return
    inflightFor.current = wantedIdentity
    setLoadingFor(wantedIdentity)

    const stale = () => inflightFor.current !== wantedIdentity

    searchSeasons(seriesName)
      .then(async cards => {
        const plausible = cards.filter(
          card =>
            (card.source ?? 'fstream') !== source &&
            card.page_url !== pageUrl &&
            card.is_film === isFilm &&
            (isFilm || card.season_number === season),
        )
        const wanted = normalize(seriesName)
        const matches = await Promise.all(
          plausible.map(async card => {
            if (normalize(card.series_name) === wanted) return card
            if (!tmdbId) return null
            const meta = await lookupTmdb(
              card.series_name, card.year ?? 0, card.is_film,
            )
            return meta?.tmdb_id === tmdbId ? card : null
          }),
        )
        if (stale()) return
        // Results are kept even if the menu was closed meanwhile, so reopening
        // it shows them instantly instead of starting over.
        setResult({
          identity: wantedIdentity,
          cards: matches.filter((c): c is SeasonCard => c !== null),
        })
        loadedFor.current = wantedIdentity
      })
      .catch(() => {
        if (!stale()) setResult({ identity: wantedIdentity, cards: [] })
      })
      .finally(() => {
        if (stale()) return
        inflightFor.current = ''
        setLoadingFor('')
      })
  }

  const sources = useMemo(() => {
    const found = result.identity === identity ? result.cards : []
    const name = (id: string) => labels.get(id) ?? id
    const list: AlternateSource[] = [
      {
        source,
        label: name(source),
        page_url: pageUrl,
        series_name: seriesName,
        poster_url: '',
        year: 0,
        current: true,
      },
    ]
    const seen = new Set([pageUrl])
    for (const alt of [...merged, ...found]) {
      if (seen.has(alt.page_url)) continue
      seen.add(alt.page_url)
      const id = alt.source ?? 'fstream'
      list.push({
        source: id,
        label: name(id),
        page_url: alt.page_url,
        series_name: alt.series_name,
        poster_url: alt.poster_url,
        year: alt.year ?? 0,
        current: false,
      })
    }
    return list
  }, [labels, merged, result, identity, source, pageUrl, seriesName])

  return { sources, loading, ensureLoaded }
}
