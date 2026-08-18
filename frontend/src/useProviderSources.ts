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

/** How long a local file gets to report its metadata before it counts as dead. */
const DECODE_TIMEOUT = 8000

/**
 * Whether this browser can actually decode what is at *url*.
 *
 * A file on disk can be perfectly reachable and still unplayable: an HLS
 * download that was never remuxed holds MPEG-TS under an `.mp4` name, is served
 * as `video/mp4` on the strength of that name, and is refused by every browser.
 * Only a media element knows, and it knows from the header alone — so this
 * costs a few kilobytes off local disk.
 *
 * Resolves false rather than throwing: an unreadable source is an answer, not
 * an error.
 */
function canDecode(url: string, signal: AbortSignal): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const probe = document.createElement('video')
    probe.preload = 'metadata'
    probe.muted = true
    let timer = 0
    const onAbort = () => settle(false)
    const settle = (ok: boolean) => {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      probe.onloadedmetadata = null
      probe.onerror = null
      // Drop the pending request; without the load() the fetch outlives us.
      probe.removeAttribute('src')
      probe.load()
      resolve(ok)
    }
    probe.onloadedmetadata = () => settle(true)
    probe.onerror = () => settle(false)
    signal.addEventListener('abort', onAbort)
    timer = window.setTimeout(() => settle(false), DECODE_TIMEOUT)
    probe.src = url
  })
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

/** Status map for a fresh episode: nothing is playable until it is probed —
 *  the copy on disk included, since existing and decoding are not the same. */
function seedStatus(providers: string[]): Record<string, ProviderStatus> {
  return Object.fromEntries(
    providers.map(p => [p, 'loading']),
  ) as Record<string, ProviderStatus>
}

/**
 * Probe every provider for an episode on mount, tracking per-provider status.
 * `active` (the provider to actually use) is the first one to answer — playback
 * starts there and then, without waiting for the slower hosts to finish. Only
 * one media is ever loaded: once something is playing nothing replaces it, and
 * the rest of the probes only fill in the chips. The user can override by
 * selecting a chip, and their choice is never overridden.
 *
 * A downloaded copy (`downloadedSource`) leads the list and wins the screen
 * whenever it plays at all, but it has to earn that like anything else: it is
 * checked with `canDecode`, against local disk rather than the network, so the
 * wait is short. It was once trusted unprobed on the grounds that the file is
 * known to exist — which let an unplayable container (MPEG-TS under an `.mp4`
 * name) hold the player on a spinner for ever, silently, because a source that
 * never loads never errors either, and so never falls back.
 *
 * While that check is outstanding a remote that answers first fills in its chip
 * but does not take the screen; it takes over only if the local copy turns out
 * not to decode. `markFailed('downloaded')` remains the escape hatch for a file
 * that dies later, mid-playback.
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
  const [sources, setSources] = useState<Record<string, StreamSource>>({})
  const [active, setActive] = useState<string | null>(null)
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
    setSources({})
    // Plain setter, not setActiveBoth: this runs during render, and the ref is
    // the effect's to assign (it does so before awaiting anything).
    setActive(null)
    setProbing(true)
  }

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    sourcesRef.current = {}
    activeRef.current = null
    // Held while the copy on disk is still being checked: it outranks every
    // host, so a remote that answers meanwhile waits its turn.
    let localPending = local !== null

    const claim = (p: string) => {
      if (!cancelled && activeRef.current === null) setActiveBoth(p)
    }
    const offer = (p: string, src: StreamSource) => {
      sourcesRef.current[p] = src
      setSources(prev => ({ ...prev, [p]: src }))
      setStatus(prev => ({ ...prev, [p]: 'ok' }))
    }

    const localProbe = local
      ? canDecode(local.proxy_url, controller.signal).then(ok => {
          if (cancelled) return
          localPending = false
          if (ok) {
            offer(DOWNLOADED_PROVIDER, local)
            claim(DOWNLOADED_PROVIDER)
            return
          }
          setStatus(prev => ({ ...prev, [DOWNLOADED_PROVIDER]: 'failed' }))
          // Hand the screen to whichever host answered while we were waiting;
          // if none has yet, the next one to answer claims it itself.
          const ready = remote.find(p => sourcesRef.current[p])
          if (ready) claim(ready)
        })
      : Promise.resolve()

    Promise.allSettled([
      localProbe,
      ...remote.map(async p => {
        try {
          const src = await probeSource(p, embedUrls[p], controller.signal, source)
          if (cancelled) return
          offer(p, src)
          // Play the first host that answers, rather than waiting for the rest
          // to finish. Preference order decided which host to *prefer*, not how
          // long to sit on a black screen for it: one slow host held up every
          // other one that was already working. Still exactly one media loaded
          // — nothing switches once something is playing.
          if (!localPending) claim(p)
        } catch {
          if (cancelled) return
          setStatus(prev => ({ ...prev, [p]: 'failed' }))
        }
      }),
    ]).then(() => {
      if (cancelled) return
      // Only the chips' loading state: whatever was going to play started as
      // soon as it resolved, and if nothing did, `active` is still null.
      setProbing(false)
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
