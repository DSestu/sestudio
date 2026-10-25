import { useEffect, useState } from 'react'
import type { AppSettings, CatalogInfo } from './api'
import { getCatalogs } from './api'

const LAST_KEY = 'sestudio.catalog'
const RECENT_KEY = 'sestudio.catalogs.recent'
const RECENT_MAX = 3

/** The catalogues browsed last, most recent first. */
export function recentCatalogs(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/** Remember the catalogue last browsed, so Discover and Home reopen on it. */
export function rememberCatalog(id: string) {
  try {
    localStorage.setItem(LAST_KEY, id)
    const recent = [id, ...recentCatalogs().filter(r => r !== id)].slice(0, RECENT_MAX)
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
  } catch { /* private mode */ }
}

/** The catalogue to show: the asked-for one when it exists, else the last
 *  browsed, else the first listed ('' while none are known). */
export function pickCatalog(catalogs: CatalogInfo[], wanted: string | null): string {
  let last: string | null = null
  try { last = localStorage.getItem(LAST_KEY) } catch { /* private mode */ }
  const known = (id: string | null) => id && catalogs.some(c => c.id === id) ? id : ''
  return known(wanted) || known(last) || (catalogs[0]?.id ?? '')
}

/** The browsable catalogues. Refetched when settings that decide which exist
 *  change: a TMDB key, or a site being switched off. */
export function useCatalogs(settings: AppSettings): CatalogInfo[] {
  const [catalogs, setCatalogs] = useState<CatalogInfo[]>([])
  const key = `${settings.tmdb_configured}|${(settings.disabled_sites ?? []).join(',')}`
  useEffect(() => {
    let cancelled = false
    getCatalogs().then(c => { if (!cancelled) setCatalogs(c) }).catch(() => {})
    return () => { cancelled = true }
  }, [key])
  return catalogs
}
