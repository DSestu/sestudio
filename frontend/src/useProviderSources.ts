import { useEffect, useMemo, useRef, useState } from 'react'
import type { StreamSource } from './api'
import { resolveStream } from './api'
import { DOWNLOADED_PROVIDER, orderProviders, type ProviderStatus } from './providers'

/**
 * Resolve a provider AND test that its stream is actually readable: a tiny
 * ranged GET through the proxy hits the upstream, so a source that resolves but
 * then 403s (or is otherwise unreachable) is caught here rather than on play.
 */
async function probeSource(provider: string, embedUrl: string, signal: AbortSignal, source?: string): Promise<StreamSource> {
  const src = await resolveStream({ [provider]: embedUrl }, signal, undefined, source)
  const res = await fetch(src.proxy_url, { method: 'GET', headers: { Range: 'bytes=0-1' }, signal })
  if (!res.ok) throw new Error(`source returned HTTP ${res.status}`)
  await res.body?.cancel().catch(() => {})
  return src
}

export interface ProviderSources {
  providers: string[]
  status: Record<string, ProviderStatus>
  sources: Record<string, StreamSource>  // successfully-tested providers only
  active: string | null
  select: (provider: string) => void
  markFailed: (provider: string) => void
  probing: boolean
}

/** Status map for a fresh episode: the local copy is known good, the rest wait. */
function seedStatus(providers: string[]): Record<string, ProviderStatus> {
  return Object.fromEntries(
    providers.map(p => [p, p === DOWNLOADED_PROVIDER ? 'ok' : 'loading']),
  ) as Record<string, ProviderStatus>
}

/** The sources a fresh episode starts with: the downloaded copy, if any. */
function seedSources(local: StreamSource | null): Record<string, StreamSource> {
  return local ? { [DOWNLOADED_PROVIDER]: local } : {}
}

/**
 * Probe every provider for an episode on mount, tracking per-provider status.
 * `active` (the provider to actually use) is chosen once probing finishes — the
 * first working provider in preference order — so the caller loads exactly one
 * media at the end. The user can override it by selecting a chip.
 *
 * A downloaded copy (`downloadedSource`) short-circuits that: it leads the list, is
 * active from the first render, and is never probed — the file is known to
 * exist, and waiting on the network would defeat the point of having it. The
 * remote providers still probe in the background so switching away works, and
 * `markFailed('downloaded')` falls back to them if the file turns out to be unreadable.
 */
export function useProviderSources(
  embedUrls: Record<string, string>,
  source?: string,
  providerOrder?: string[],
  downloadedSource?: StreamSource | null,
): ProviderSources {
  // Keyed on a string so a fresh array identity doesn't re-trigger probing.
  const orderKey = providerOrder?.join('|') ?? ''
  const local = downloadedSource ?? null
  const remote = useMemo(
    () => orderProviders(Object.keys(embedUrls), orderKey ? orderKey.split('|') : undefined),
    [embedUrls, orderKey],
  )
  const providers = useMemo(
    () => (local ? [DOWNLOADED_PROVIDER, ...remote] : remote),
    [local, remote],
  )

  const [status, setStatus] = useState<Record<string, ProviderStatus>>(
    () => seedStatus(providers),
  )
  const [sources, setSources] = useState<Record<string, StreamSource>>(
    () => seedSources(local),
  )
  const [active, setActive] = useState<string | null>(local ? DOWNLOADED_PROVIDER : null)
  const [probing, setProbing] = useState(true)
  const sourcesRef = useRef<Record<string, StreamSource>>({})
  const activeRef = useRef<string | null>(null)

  const setActiveBoth = (p: string | null) => { activeRef.current = p; setActive(p) }

  // Reset when the episode (embedUrls) changes without remounting the consumer,
  // so the video player element can persist across episodes (keeps fullscreen).
  // The local copy is part of that identity: switching language swaps the file.
  const [prev, setPrev] = useState<{ embeds: Record<string, string>; local: StreamSource | null }>(
    () => ({ embeds: embedUrls, local }),
  )
  if (prev.embeds !== embedUrls || prev.local !== local) {
    setPrev({ embeds: embedUrls, local })
    setStatus(seedStatus(providers))
    setSources(seedSources(local))
    // Plain setter, not setActiveBoth: this runs during render, and the ref is
    // the effect's to assign (it does so before awaiting anything).
    setActive(local ? DOWNLOADED_PROVIDER : null)
    setProbing(true)
  }

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    // The local file needs no probe, but must be in the ref so `markFailed` on a
    // remote provider can still fall back to it.
    sourcesRef.current = seedSources(local)
    activeRef.current = local ? DOWNLOADED_PROVIDER : null
    Promise.allSettled(
      remote.map(async p => {
        try {
          const src = await probeSource(p, embedUrls[p], controller.signal, source)
          if (cancelled) return
          sourcesRef.current[p] = src
          setSources(prev => ({ ...prev, [p]: src }))
          setStatus(prev => ({ ...prev, [p]: 'ok' }))
        } catch {
          if (cancelled) return
          setStatus(prev => ({ ...prev, [p]: 'failed' }))
        }
      }),
    ).then(() => {
      if (cancelled) return
      setProbing(false)
      // Load exactly one media: the first working provider, unless the user
      // already picked one while probing.
      if (activeRef.current === null) {
        const firstOk = providers.find(q => sourcesRef.current[q]) ?? null
        setActiveBoth(firstOk)
      }
    })
    return () => { cancelled = true; controller.abort() }
  }, [providers, remote, local, embedUrls, source])

  const select = (p: string) => setActiveBoth(p)

  const markFailed = (p: string) => {
    setStatus(prev => ({ ...prev, [p]: 'failed' }))
    delete sourcesRef.current[p]
    setSources(prev => { const next = { ...prev }; delete next[p]; return next })
    if (activeRef.current === p) {
      setActiveBoth(providers.find(q => sourcesRef.current[q]) ?? null)
    }
  }

  return { providers, status, sources, active, select, markFailed, probing }
}
