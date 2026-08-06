import { useEffect, useMemo, useRef, useState } from 'react'
import type { StreamSource } from './api'
import { resolveStream } from './api'
import { orderProviders, type ProviderStatus } from './providers'

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

/**
 * Probe every provider for an episode on mount, tracking per-provider status.
 * `active` (the provider to actually use) is chosen once probing finishes — the
 * first working provider in preference order — so the caller loads exactly one
 * media at the end. The user can override it by selecting a chip.
 */
export function useProviderSources(
  embedUrls: Record<string, string>,
  source?: string,
  providerOrder?: string[],
): ProviderSources {
  // Keyed on a string so a fresh array identity doesn't re-trigger probing.
  const orderKey = providerOrder?.join('|') ?? ''
  const providers = useMemo(
    () => orderProviders(Object.keys(embedUrls), orderKey ? orderKey.split('|') : undefined),
    [embedUrls, orderKey],
  )
  const [status, setStatus] = useState<Record<string, ProviderStatus>>(
    () => Object.fromEntries(providers.map(p => [p, 'loading'])),
  )
  const [sources, setSources] = useState<Record<string, StreamSource>>({})
  const [active, setActive] = useState<string | null>(null)
  const [probing, setProbing] = useState(true)
  const sourcesRef = useRef<Record<string, StreamSource>>({})
  const activeRef = useRef<string | null>(null)

  // Reset when the episode (embedUrls) changes without remounting the consumer,
  // so the video player element can persist across episodes (keeps fullscreen).
  const [prevEmbed, setPrevEmbed] = useState(embedUrls)
  if (prevEmbed !== embedUrls) {
    setPrevEmbed(embedUrls)
    setStatus(Object.fromEntries(providers.map(p => [p, 'loading'])))
    setSources({})
    setActive(null)
    setProbing(true)
  }

  const setActiveBoth = (p: string | null) => { activeRef.current = p; setActive(p) }

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    sourcesRef.current = {}
    activeRef.current = null
    Promise.allSettled(
      providers.map(async p => {
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
  }, [providers, embedUrls, source])

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
