import { useEffect, useState } from 'react'

/** Destinations that appear in the nav rail / tab bar. */
export const TABS = ['home', 'search', 'library', 'downloaded', 'downloads', 'notifications'] as const
export type Tab = (typeof TABS)[number]

/**
 * All routable views. `watch` is reachable only by opening a title, `settings`
 * only from the settings control, `person` only from a cast/director credit —
 * none takes a slot in the nav.
 */
export type View = Tab | 'watch' | 'settings' | 'person'

const VIEWS: readonly string[] = [...TABS, 'watch', 'settings', 'person']

export interface Route {
  view: View
  params: URLSearchParams
  /** Counts navigations: a link or the back button, never replaceParams. A
   *  view keyed by it starts afresh from the URL each time it is navigated to,
   *  even when the URL it lands on is one it already showed. */
  visit: number
}

function parseHash(): Omit<Route, 'visit'> {
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
let visits = 0
// The hash the route state was last taken from, so the hashchange that follows
// navigate() re-affirms its visit instead of counting a second one.
let routedHash = ''

function visit(): Route {
  routedHash = window.location.hash
  return { ...parseHash(), visit: ++visits }
}

export function useRoute(): [Route, Navigate] {
  const [route, setRoute] = useState<Route>(visit)

  useEffect(() => {
    const onHash = () => { if (window.location.hash !== routedHash) setRoute(visit()) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigate: Navigate = (view, params) => {
    const next = hashFor(view, params)
    if (window.location.hash !== next) window.location.hash = next
    // Update synchronously so a caller can wrap navigate() in a View Transition
    // and have the new DOM captured; the hashchange listener re-affirms state
    // for the browser back/forward buttons.
    setRoute(visit())
  }

  return [route, navigate]
}

/** Params for opening a title in the watch view. */
export function watchParams(pageUrl: string, lang: string, episode?: number, source?: string) {
  return { u: pageUrl, lang, ep: episode, src: source }
}

/**
 * Rewrite the current entry's params without adding a history entry or firing
 * hashchange. Lets a view persist live state (query text, filters) into the
 * URL so browser-back lands on it exactly as it was left.
 */
export function replaceParams(view: View, params?: Record<string, string | number | undefined>) {
  history.replaceState(null, '', hashFor(view, params))
}

/** The current entry's params, read fresh: replaceParams/patchParams change the
 *  URL without updating any route state, so a mounting view reads them here. */
export function currentParams(): URLSearchParams {
  return parseHash().params
}

/**
 * Like replaceParams, but only the given keys change and the rest of the
 * current entry is kept — for a component nested in a view (the downloaded
 * shelf inside a Library tab) that must not wipe the params its host owns.
 */
export function patchParams(patch: Record<string, string | undefined>) {
  const { view, params } = parseHash()
  replaceParams(view, { ...Object.fromEntries(params), ...patch })
}
