import { useEffect, useState } from 'react'
import type { Renderer, StreamSource, StreamSubtitle } from '../../api'
import { dlnaPlay, getCastHttpPort, listRenderers, downloadedFileUrl, resolveStream } from '../../api'
import { fileFor, downloadedSnapshot } from '../../downloadedLibrary'
import { castSeek, castToChromecast, loadCast, useCastState } from '../../cast'
import { dlnaSeek, dlnaStarted, useDlnaState } from '../../dlnaControl'
import { startCastQueue } from '../../castQueue'
import { startCastSession } from '../../playbackSession'
import type { PlayableEpisode } from '../../providers'

const CAST_ICON =
  'M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2h-5M3 11a6 6 0 016 6M3 15a2 2 0 012 2M3 19h.01'

/**
 * Is *host* a plain-LAN address the app is reached at directly?
 *
 * Only then is the plain-HTTP media trick (below) both possible and necessary.
 * Reached through a public name — a Tailscale Funnel domain, say — the app has a
 * publicly trusted cert, so the receiver can just use the page's own origin;
 * rewriting to http://<that name>:<port> would instead point it at a port
 * nothing serves plaintext on.
 */
function isLanHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  )
}

interface Props {
  episodes: PlayableEpisode[]
  index: number
  /** Verified source for the current episode, or null while probing/failed. */
  source: StreamSource | null
  autoplay: boolean
  /** Browser position (seconds) to resume from when handing off to a TV. */
  handoffAt: number
  onSourceFailed: () => void
}

/**
 * "Cast this episode" — sends the currently-browsed episode to a TV
 * (Chromecast/AirPlay or DLNA). Casting is decoupled from the browser player:
 * it does not stop or replace local playback, it just starts (or replaces) the
 * TV session, which the persistent Now-Casting bar then controls. Picking a
 * different episode and casting it again swaps what's on the TV.
 */
export default function OutputSwitcher({
  episodes, index, source, autoplay, handoffAt, onSourceFailed,
}: Props) {
  const [renderers, setRenderers] = useState<Renderer[] | null>(null)
  const [castAvailable, setCastAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  const cast = useCastState()
  const dlna = useDlnaState()
  const casting = cast.connected || dlna.connected
  const ep = episodes[index]

  useEffect(() => {
    let cancelled = false
    loadCast().then(ok => { if (!cancelled) setCastAvailable(ok) })
    listRenderers()
      .then(r => { if (!cancelled) setRenderers(r) })
      .catch(() => { if (!cancelled) setRenderers([]) })
    return () => { cancelled = true }
  }, [])

  /** Send one episode's stream to the chosen target. */
  async function sendTo(
    proxyUrl: string,
    kind: string,
    title: string,
    mode: 'dlna' | 'chromecast',
    udn?: string,
    // Sidecar subtitles to side-load. Empty for a downloaded file, and ignored
    // on DLNA, which has no portable way to carry them.
    subtitles: StreamSubtitle[] = [],
  ) {
    if (mode === 'dlna' && udn) {
      await dlnaPlay(udn, proxyUrl, title, kind)
      dlnaStarted()
    } else {
      // On a LAN address the app's cert is self-signed and Chromecast can't
      // verify it, so fetch over plain HTTP on the app's direct port instead
      // (not the HTTPS front the browser is using). The receiver fetches the
      // subtitles itself, so they need the same treatment — an https URL here
      // loads the video with silently missing captions.
      //
      // Reached by a public name, or with no HTTP server running at all, that
      // rewrite has nothing to point at: keep the media on this origin, whose
      // cert the receiver can verify.
      const port = await getCastHttpPort()
      const host = window.location.hostname
      const base = port !== null && isLanHost(host) ? `http://${host}:${port}` : window.location.origin
      const onLan = (path: string) => `${base}${path}`
      await castToChromecast(
        onLan(proxyUrl),
        kind === 'hls' ? 'application/x-mpegurl' : 'video/mp4',
        title,
        subtitles.map(sub => ({
          url: onLan(sub.proxy_url),
          lang: sub.lang,
          label: sub.label,
          default: sub.default,
        })),
      )
    }
  }

  async function startCast(label: string, mode: 'dlna' | 'chromecast', udn?: string) {
    if (!source) { setMsg('No working source selected.'); return }
    setBusy(true)
    setMsg(`Sending to ${label}…`)
    try {
      await sendTo(source.proxy_url, source.kind, ep.title, mode, udn, source.subtitles)
      startCastSession(ep, mode)
      // Handoff: continue on the TV from where the browser player was.
      if (handoffAt > 5) {
        if (mode === 'dlna') {
          await new Promise(r => setTimeout(r, 1500)) // let the renderer load
          await dlnaSeek(handoffAt).catch(() => {})
        } else {
          castSeek(handoffAt)
        }
      }
      // Register the playlist so the controller can autoplay the next episode.
      startCastQueue({
        episodes,
        index,
        autoplay,
        cast: async (next) => {
          // Prefer the downloaded copy here too, or autoplay-next would quietly
          // drop back to scraping partway through a locally-played season.
          const local = fileFor(
            downloadedSnapshot(), next.series_name, next.season, next.number, next.lang,
          )
          if (local) {
            await sendTo(downloadedFileUrl(local.path), 'mp4', next.title, mode, udn)
            return
          }
          const src = await resolveStream(next.embed_urls, undefined, undefined, next.source)
          await sendTo(src.proxy_url, src.kind, next.title, mode, udn, src.subtitles)
        },
      })
      setMsg(null)
      setPicking(false)
    } catch (err) {
      onSourceFailed() // the device couldn't read this source
      setMsg(err instanceof Error ? err.message : 'Cast failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setPicking(p => !p)} className="btn btn-sm btn-outline gap-1" aria-expanded={picking}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d={CAST_ICON} />
          </svg>
          {casting ? 'Cast this episode' : 'Send to TV'}
        </button>
        {casting && (
          <span className="text-xs text-base-content/50">
            Casting continues below — this swaps what’s on the TV.
          </span>
        )}
      </div>

      {/* Device picker — inline, not an overlay */}
      {picking && (
        <div className="rounded-box border border-base-300 bg-base-200 p-3 flex flex-col gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-base-content/40 mb-1">Chromecast &amp; AirPlay</p>
            {castAvailable ? (
              <button
                disabled={busy || !source}
                onClick={() => startCast('Chromecast', 'chromecast')}
                className="btn btn-sm btn-block justify-start gap-3"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={CAST_ICON} />
                </svg>
                Cast to Chromecast…
              </button>
            ) : (
              <p className="text-xs text-base-content/50">
                Chromecast needs the app served over HTTPS. AirPlay is available from the player controls in Safari.
              </p>
            )}
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-base-content/40 mb-1">On your network (DLNA)</p>
            {renderers === null && (
              <div className="flex items-center gap-2 py-2 text-base-content/60 text-sm">
                <span className="loading loading-spinner loading-sm" /> Scanning…
              </div>
            )}
            {renderers?.length === 0 && (
              <p className="text-base-content/60 text-sm py-2">No DLNA devices found.</p>
            )}
            {renderers && renderers.length > 0 && (
              <ul className="menu bg-base-100 rounded-box gap-1 px-0">
                {renderers.map(r => (
                  <li key={r.udn}>
                    <button disabled={busy || !source} onClick={() => startCast(r.name, 'dlna', r.udn)} className="flex items-center gap-3">
                      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={CAST_ICON} />
                      </svg>
                      <span className="truncate">{r.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {!source && <p className="text-error text-xs">No working source — nothing to cast.</p>}
        </div>
      )}

      {msg && <p role="status" className="text-sm text-base-content/70">{msg}</p>}
    </div>
  )
}
