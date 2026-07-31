import { useEffect, useState } from 'react'
import type { Renderer } from '../api'
import { dlnaPlay, getCastHttpPort, listRenderers, resolveStream } from '../api'
import { castToChromecast, loadCast } from '../cast'
import { dlnaStarted } from '../dlnaControl'
import { startCastQueue } from '../castQueue'
import type { PlayableEpisode } from '../providers'
import { useProviderSources } from '../useProviderSources'
import { useModalBack } from '../useModalBack'
import ProviderChips from './ProviderChips'

interface Props {
  episodes: PlayableEpisode[]
  startIndex: number
  onClose: () => void
}

const CAST_ICON =
  'M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2h-5M3 11a6 6 0 016 6M3 15a2 2 0 012 2M3 19h.01'

type CastMode = 'dlna' | 'chromecast'

/** Modal that casts an episode to a TV — via Chromecast (browser) or DLNA (server). */
export default function CastModal({ episodes, startIndex, onClose }: Props) {
  useModalBack(true, onClose)
  const current = episodes[startIndex]
  // Sources are tested up front, so the chosen one is already verified before
  // we issue any cast command.
  const { providers, status, sources, active, select, markFailed, probing } = useProviderSources(current.embed_urls)
  const [renderers, setRenderers] = useState<Renderer[] | null>(null)
  const [castAvailable, setCastAvailable] = useState(false)
  const [autoplay, setAutoplay] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadCast().then(ok => { if (!cancelled) setCastAvailable(ok) })
    listRenderers()
      .then(r => { if (!cancelled) setRenderers(r) })
      .catch(() => { if (!cancelled) setRenderers([]) })
    return () => { cancelled = true }
  }, [])

  const activeSource = active ? sources[active] : null

  // Cast a single episode's stream to the chosen target. Reused for the initial
  // cast and (via the queue) for autoplay of subsequent episodes.
  async function castSource(proxyUrl: string, kind: string, epTitle: string, mode: CastMode, udn?: string) {
    if (mode === 'dlna' && udn) {
      await dlnaPlay(udn, proxyUrl, epTitle, kind)
      dlnaStarted()
    } else {
      // Chromecast can't verify a local CA, so fetch over plain HTTP on the
      // app's direct port (not the HTTPS front the browser is using).
      const port = await getCastHttpPort()
      const absolute = `http://${window.location.hostname}:${port}${proxyUrl}`
      const contentType = kind === 'hls' ? 'application/x-mpegurl' : 'video/mp4'
      await castToChromecast(absolute, contentType, epTitle)
    }
  }

  async function startCast(label: string, mode: CastMode, udn?: string) {
    if (!activeSource || !active) { setMsg('No working source selected.'); return }
    setBusy(true)
    setMsg(`Sending to ${label}…`)
    try {
      await castSource(activeSource.proxy_url, activeSource.kind, current.title, mode, udn)
      // Register the playlist so the controller can autoplay the next episode.
      startCastQueue({
        episodes,
        index: startIndex,
        autoplay,
        cast: async (ep) => {
          const src = await resolveStream(ep.embed_urls)
          await castSource(src.proxy_url, src.kind, ep.title, mode, udn)
        },
      })
      setMsg(`▶ Playing on ${label}`)
    } catch (err) {
      markFailed(active)  // the device couldn't read this source
      setMsg(err instanceof Error ? err.message : 'Cast failed')
    } finally {
      setBusy(false)
    }
  }

  const canCast = !busy && !probing && !!activeSource

  return (
    <div className="modal modal-open" onClick={onClose}>
      <div className="modal-box max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 mb-1">
          <h2 className="font-semibold text-base">Cast to a device</h2>
          <div className="flex items-center gap-3 shrink-0">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-base-content/70" title="Cast the next episode automatically">
              <input
                type="checkbox"
                className="toggle toggle-primary toggle-sm"
                checked={autoplay}
                onChange={e => setAutoplay(e.target.checked)}
              />
              Autoplay
            </label>
            <button onClick={onClose} className="btn btn-sm btn-circle btn-ghost" aria-label="Close">✕</button>
          </div>
        </div>
        <p className="text-base-content/60 text-sm mb-3 truncate">{current.title}</p>

        {/* Providers (tested up front) */}
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wide text-base-content/40 mb-1">
            Source {probing && <span className="text-base-content/30">· testing…</span>}
          </p>
          <ProviderChips providers={providers} active={active} status={status} onSelect={select} disabled={busy} />
          {!probing && !activeSource && (
            <p className="text-error text-xs mt-2">No working source — nothing to cast.</p>
          )}
        </div>

        {/* Chromecast (browser, needs HTTPS) */}
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wide text-base-content/40 mb-1">Chromecast &amp; AirPlay</p>
          {castAvailable ? (
            <button disabled={!canCast} onClick={() => startCast('Chromecast', 'chromecast')} className="btn btn-sm btn-block justify-start gap-3">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={CAST_ICON} />
              </svg>
              Cast to Chromecast…
            </button>
          ) : (
            <p className="text-xs text-base-content/50">
              Chromecast needs the app served over HTTPS. AirPlay is available from the in-browser player (▶) in Safari.
            </p>
          )}
        </div>

        {/* DLNA (server, works over plain HTTP) */}
        <p className="text-xs uppercase tracking-wide text-base-content/40 mb-1">On your network (DLNA)</p>
        {renderers === null && (
          <div className="flex items-center gap-2 py-4 text-base-content/60">
            <span className="loading loading-spinner loading-sm" /> Scanning…
          </div>
        )}
        {renderers?.length === 0 && (
          <p className="text-base-content/60 text-sm py-4">No DLNA devices found.</p>
        )}
        {renderers && renderers.length > 0 && (
          <ul className="menu bg-base-200 rounded-box gap-1 px-0">
            {renderers.map(r => (
              <li key={r.udn}>
                <button disabled={!canCast} onClick={() => startCast(r.name, 'dlna', r.udn)} className="flex items-center gap-3">
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={CAST_ICON} />
                  </svg>
                  <span className="truncate">{r.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {msg && <p className="text-sm mt-4 text-center text-base-content/70">{msg}</p>}
      </div>
    </div>
  )
}
