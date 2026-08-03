import { useEffect, useState } from 'react'

/** Destinations that appear in the nav rail / tab bar. */
export const TABS = ['home', 'search', 'library', 'downloads'] as const
export type Tab = (typeof TABS)[number]

/** All routable views. `watch` is reachable only by opening a title. */
export type View = Tab | 'watch'

const VIEWS: readonly string[] = [...TABS, 'watch']

export interface Route {
  view: View
  params: URLSearchParams
}

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [path, query] = raw.split('?')
  return {
    view: VIEWS.includes(path) ? (path as View) : 'home',
    params: new URLSearchParams(query ?? ''),
  }
}

function hashFor(view: View, params?: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== '') q.set(k, String(v))
  }
  const query = q.toString()
  return `#/${view}${query ? `?${query}` : ''}`
}

export type Navigate = (view: View, params?: Record<string, string | number | undefined>) => void

/**
 * Route state synced to the URL hash, so reloads, deep links and the browser
 * back button behave. Deliberately hand-rolled — a router would be the only
 * runtime dependency added for five routes.
 */
export function useRoute(): [Route, Navigate] {
  const [route, setRoute] = useState<Route>(parseHash)

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigate: Navigate = (view, params) => {
    const next = hashFor(view, params)
    if (window.location.hash !== next) window.location.hash = next
    // Update synchronously so a caller can wrap navigate() in a View Transition
    // and have the new DOM captured; the hashchange listener re-affirms state
    // for the browser back/forward buttons.
    setRoute(parseHash())
  }

  return [route, navigate]
}

/** Params for opening a title in the watch view. */
export function watchParams(pageUrl: string, lang: string, episode?: number) {
  return { u: pageUrl, lang, ep: episode }
}
