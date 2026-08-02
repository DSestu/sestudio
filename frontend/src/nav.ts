import { useEffect, useState } from 'react'

/** Top-level destinations. The shell renders exactly one at a time. */
export const VIEWS = ['home', 'search', 'library', 'downloads'] as const
export type View = (typeof VIEWS)[number]

function parseHash(): View {
  const raw = window.location.hash.replace(/^#\/?/, '')
  return (VIEWS as readonly string[]).includes(raw) ? (raw as View) : 'home'
}

/**
 * View state synced to the URL hash, so reloads and the browser back button
 * behave. Deliberately hand-rolled — a router would be the only runtime
 * dependency added for four static destinations.
 */
export function useView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>(parseHash)

  useEffect(() => {
    const onHash = () => setView(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  function navigate(next: View) {
    // Writing the hash fires hashchange, which drives the state update.
    if (parseHash() === next) setView(next)
    else window.location.hash = `/${next}`
  }

  return [view, navigate]
}
