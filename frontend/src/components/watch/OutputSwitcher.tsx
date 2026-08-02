import { useEffect, useState } from 'react'
import type { Renderer, StreamSource } from '../../api'
import { dlnaPlay, getCastHttpPort, listRenderers, resolveStream } from '../../api'
import {
  castPlayPause, castSeek, castSeekBy, castSetVolume, castStop, castToChromecast,
  castToggleMute, castVolumeBy, loadCast, useCastState,
} from '../../cast'
import {
  dlnaPause, dlnaResume, dlnaSeek, dlnaSeekBy, dlnaSetVolume, dlnaStarted, dlnaStop,
  dlnaToggleMute, dlnaVolumeBy, useDlnaState,
} from '../../dlnaControl'
import { startCastQueue } from '../../castQueue'
import { startPlayback } from '../../playbackSession'
import type { PlayableEpisode } from '../../providers'
import Transport from '../cast/Transport'

export type Output = 'browser' | 'chromecast' | 'dlna'

const CAST_ICON =
  'M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2h-5M3 11a6 6 0 016 6M3 15a2 2 0 012 2M3 19h.01'

interface Props {
  episodes: PlayableEpisode[]
  index: number
  /** Verified source for the current episode, or null while probing/failed. */
  source: StreamSource | null
  output: Output
  onOutputChange: (o: Output) => void
  autoplay: boolean
  /** Browser position (seconds) to resume from when handing off to a TV. */
  handoffAt: number
  onSourceFailed: () => void
}

/**
 * "Playing on …" — picks the output for this title and, when that output is a
 * TV, renders the transport inline where the video would be. Replaces the old
 * stacked cast modal; the floating pills remain for when the user navigates
 * away from the watch view.
 */
export default function OutputSwitcher({
  episodes, index, source, output, onOutputChange, autoplay, handoffAt, onSourceFailed,
}: Props) {
  const [renderers, setRenderers] = useState<Renderer[] | null>(null)
  const [castAvailable, setCastAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  const cast = useCastState()
  const dlna = useDlnaState()
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
  async function sendTo(proxyUrl: string, kind: string, title: string, mode: 'dlna' | 'chromecast', udn?: string) {
    if (mode === 'dlna' && udn) {
      await dlnaPlay(udn, proxyUrl, title, kind)
      dlnaStarted()
    } else {
      // Chromecast can't verify a local CA, so fetch over plain HTTP on the
      // app's direct port (not the HTTPS front the browser is using).
      const port = await getCastHttpPort()
      const absolute = `http://${window.location.hostname}:${port}${proxyUrl}`
      await castToChromecast(absolute, kind === 'hls' ? 'application/x-mpegurl' : 'video/mp4', title)
    }
  }

  async function startCast(label: string, mode: 'dlna' | 'chromecast', udn?: string) {
    if (!source) { setMsg('No working source selected.'); return }
    setBusy(true)
    setMsg(`Sending to ${label}…`)
    try {
      await sendTo(source.proxy_url, source.kind, ep.title, mode, udn)
      startPlayback(ep, mode)
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
          const src = await resolveStream(next.embed_urls)
          await sendTo(src.proxy_url, src.kind, next.title, mode, udn)
        },
      })
      setMsg(null)
      setPicking(false)
      onOutputChange(mode)
    } catch (err) {
      onSourceFailed() // the device couldn't read this source
      setMsg(err instanceof Error ? err.message : 'Cast failed')
    } finally {
      setBusy(false)
    }
  }

  function backToBrowser() {
    if (output === 'chromecast') castStop()
    if (output === 'dlna') dlnaStop()
    onOutputChange('browser')
    setMsg(null)
  }

  const label = output === 'browser'
    ? 'This browser'
    : output === 'chromecast'
    ? (cast.title ? 'Chromecast' : 'Chromecast')
    : (dlna.title ? 'TV' : 'TV')

  return (
    <div className="flex flex-col gap-3">
      {/* Output selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs uppercase tracking-wide text-base-content/40">Playing on</span>
        <span className="badge badge-primary badge-sm gap-1">
          {output !== 'browser' && (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={CAST_ICON} />
            </svg>
          )}
          {label}
        </span>
        {output === 'browser' ? (
          <button onClick={() => setPicking(p => !p)} className="btn btn-xs btn-outline gap-1" aria-expanded={picking}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={CAST_ICON} />
            </svg>
            Send to TV
          </button>
        ) : (
          <button onClick={backToBrowser} className="btn btn-xs btn-outline">Watch here</button>
        )}
      </div>

      {/* Device picker — inline, not an overlay */}
      {picking && output === 'browser' && (
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

      {/* Inline transport, in place of the video, while a TV owns playback */}
      {output === 'chromecast' && cast.connected && (
        <div className="rounded-box border border-base-300 bg-base-200 p-4">
          <Transport
            position={cast.currentTime}
            duration={cast.duration}
            isPaused={cast.isPaused}
            muted={cast.muted}
            volume={cast.volume}
            canSeek={cast.canSeek}
            canControlVolume={cast.canControlVolume}
            onSeek={castSeek}
            onSeekBy={castSeekBy}
            onPlayPause={castPlayPause}
            onToggleMute={castToggleMute}
            onSetVolume={castSetVolume}
            onVolumeBy={castVolumeBy}
          />
          <div className="flex justify-end mt-4">
            <button onClick={() => { castStop(); onOutputChange('browser') }} className="btn btn-error btn-sm">
              Stop casting
            </button>
          </div>
        </div>
      )}

      {output === 'dlna' && dlna.connected && (
        <div className="rounded-box border border-base-300 bg-base-200 p-4">
          <Transport
            position={dlna.position}
            duration={dlna.duration}
            isPaused={dlna.isPaused}
            muted={dlna.muted}
            volume={dlna.volume}
            onSeek={dlnaSeek}
            onSeekBy={dlnaSeekBy}
            onPlayPause={() => (dlna.isPaused ? dlnaResume() : dlnaPause())}
            onToggleMute={dlnaToggleMute}
            onSetVolume={dlnaSetVolume}
            onVolumeBy={dlnaVolumeBy}
          />
          <div className="flex justify-end mt-4">
            <button onClick={() => { dlnaStop(); onOutputChange('browser') }} className="btn btn-error btn-sm">
              Stop casting
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
