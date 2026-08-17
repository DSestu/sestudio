import { useEffect, useState } from 'react'
import { getSeason } from './api'
import type { AlternateSource } from './useAlternateSources'

/** One site's listing of the open title, with what it can actually play. */
export interface SourceListing {
  source: string
  label: string
  page_url: string
  /** The listing's own poster and title, as the switcher used to show them. */
  poster_url: string
  series_name: string
  year: number
  /** True for the listing currently on screen. */
  current: boolean
  /** Still being fetched — its languages and hosts are not known yet. */
  loading: boolean
  /** The site could not serve this listing; it stays visible, marked. */
  failed: boolean
  /** Every language this listing offers, across its episodes. */
  langs: string[]
  /** Languages per episode number. */
  epLangs: Record<number, string[]>
  /** Stream hosts per episode number. */
  hosts: Record<number, string[]>
  /** Episode titles, so an episode only this site has can still be named. */
  epTitles: Record<number, string>
  /** Embed urls per episode, so a download can be taken from this site
   *  without opening it first. */
  embeds: Record<number, Record<string, string>>
}

interface Fetched {
  langs: string[]
  epLangs: Record<number, string[]>
  hosts: Record<number, string[]>
  epTitles: Record<number, string>
  embeds: Record<number, Record<string, string>>
  failed: boolean
}

/**
 * What each site can play for the open title — languages and hosts, per episode.
 *
 * A site is not uniform with its peers: senpai carries mostly VF, the DLE sites
 * usually carry VOSTFR too, and neither knows about the other. Asking only the
 * open listing therefore hides half the versions that exist, so every listing is
 * fetched and reported side by side.
 *
 * One request per site, once per language, cached for as long as the sites and
 * the language hold still. The open listing is fetched too rather than reusing
 * the detail already on screen: it keeps every row built the same way, and the
 * request is the one the season view just made, so it comes back from the
 * browser's cache.
 */
export function useSourceListings(
  sources: AlternateSource[],
  lang: string,
): SourceListing[] {
  const [byKey, setByKey] = useState<Record<string, Fetched>>({})
  // Identity of the whole set, so adding a site refetches nothing already held.
  const urlKey = sources.map(s => `${s.source}|${s.page_url}`).join(',')

  useEffect(() => {
    if (!lang || !sources.length) return
    let cancelled = false

    for (const src of sources) {
      const key = `${src.source}|${src.page_url}|${lang}`
      if (byKey[key]) continue
      void getSeason(src.page_url, lang, src.source)
        .then(detail => {
          const epLangs: Record<number, string[]> = {}
          const hosts: Record<number, string[]> = {}
          const epTitles: Record<number, string> = {}
          const embeds: Record<number, Record<string, string>> = {}
          for (const ep of detail.episodes) {
            if (ep.langs?.length) epLangs[ep.number] = ep.langs
            if (ep.providers.length) hosts[ep.number] = ep.providers
            epTitles[ep.number] = ep.title
            if (ep.providers.length) embeds[ep.number] = ep.embed_urls
          }
          if (cancelled) return
          setByKey(prev => ({
            ...prev,
            [key]: {
              langs: detail.available_langs,
              epLangs,
              hosts,
              epTitles,
              embeds,
              failed: false,
            },
          }))
        })
        .catch(() => {
          if (cancelled) return
          setByKey(prev => ({
            ...prev,
            [key]: {
              langs: [], epLangs: {}, hosts: {}, epTitles: {}, embeds: {},
              failed: true,
            },
          }))
        })
    }

    return () => { cancelled = true }
    // `byKey` is read to skip what is already held, not to react to it: listing
    // it would re-run the effect on every arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey, lang])

  return sources.map(src => {
    const got = byKey[`${src.source}|${src.page_url}|${lang}`]
    return {
      source: src.source,
      label: src.label,
      page_url: src.page_url,
      poster_url: src.poster_url,
      series_name: src.series_name,
      year: src.year,
      current: src.current,
      loading: !got,
      failed: got?.failed ?? false,
      langs: got?.langs ?? [],
      epLangs: got?.epLangs ?? {},
      hosts: got?.hosts ?? {},
      epTitles: got?.epTitles ?? {},
      embeds: got?.embeds ?? {},
    }
  })
}
