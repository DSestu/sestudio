import { useEffect, useState } from 'react'
import type { Renderer } from '../api'
import { dlnaPlay, getCastHttpPort, listRenderers } from '../api'
import { castToChromecast, loadCast } from '../cast'
import { useProviderSources } from '../useProviderSources'
import ProviderChips from './ProviderChips'

interface Props {
  embedUrls: Record<string, string>
  title: string
  onClose: () => void
}

const CAST_ICON =
  'M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2h-5M3 11a6 6 0 016 6M3 15a2 2 0 012 2M3 19h.01'

/** Modal that casts an episode to a TV — via Chromecast (browser) or DLNA (server). */
export default function CastModal({ embedUrls, title, onClose }: Props) {
  // Sources are tested up front, so the chosen one is already verified before
  // we issue any cast command.
  const { providers, status, sources, active, select, markFailed, probing } = useProviderSources(embedUrls)
  const [renderers, setRenderers] = useState<Renderer[] | null>(null)
  const [castAvailable, setCastAvailable] = useState(false)
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

  async function withStream(label: string, run: (proxyUrl: string, kind: string) => Promise<void>) {
    if (!activeSource || !active) { setMsg('No working source selected.'); return }
    setBusy(true)
    setMsg(`Sending to ${label}…`)
    try {
      await run(activeSource.proxy_url, activeSource.kind)
      setMsg(`▶ Playing on ${label}`)
    } catch (err) {
      markFailed(active)  // the device couldn't read this source
      setMsg(err instanceof Error ? err.message : 'Cast failed')
    } finally {
      setBusy(false)
    }
  }

  function castChromecast() {
    return withStream('Chromecast', async (proxyUrl, kind) => {
      // Chromecast can't verify a local CA, so fetch media over plain HTTP on the
      // app's direct port (not the HTTPS front the browser is using).
      const port = await getCastHttpPort()
      const absolute = `http://${window.location.hostname}:${port}${proxyUrl}`
      const contentType = kind === 'hls' ? 'application/x-mpegurl' : 'video/mp4'
      await castToChromecast(absolute, contentType, title)
    })
  }

  function castDlna(udn: string, name: string) {
    return withStream(name, (proxyUrl, kind) => dlnaPlay(udn, proxyUrl, title, kind))
  }

  const canCast = !busy && !probing && !!activeSource

  return (
    <div className="modal modal-open" onClick={onClose}>
      <div className="modal-box max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-base">Cast to a device</h2>
          <button onClick={onClose} className="btn btn-sm btn-circle btn-ghost">✕</button>
        </div>
        <p className="text-base-content/60 text-sm mb-3 truncate">{title}</p>

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
            <button disabled={!canCast} onClick={castChromecast} className="btn btn-sm btn-block justify-start gap-3">
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
                <button disabled={!canCast} onClick={() => castDlna(r.udn, r.name)} className="flex items-center gap-3">
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
