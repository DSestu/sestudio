import { useEffect, useState } from 'react'
import { useMediaPlayer, useMediaState } from '@vidstack/react'
import type { StreamSource } from '../../api'
import { DOWNLOADED_PROVIDER } from '../../providers'

/** A stall shorter than this is a hitch, not something to explain. */
const SHOW_AFTER = 1000
const SAMPLE_EVERY = 500
/** How far back the arrival rate is measured: long enough to smooth one
 *  segment landing in a lump, short enough to follow a connection that changes. */
const RATE_WINDOW = 3000

/** Requests that carry video: transcoded segments, and anything relayed from a host. */
const MEDIA_REQUEST = /\/api\/(downloaded\/segment|stream\/proxy)/

interface Fetched {
  /** Seconds between asking and the first byte: the server (or host) working. */
  wait: number
  /** Megabits per second once bytes flowed: the connection. */
  mbps: number | null
}

/** Seconds of media buffered ahead of *t*, in the range that contains it. */
export function bufferedAhead(buffered: TimeRanges, t: number): number {
  for (let i = 0; i < buffered.length; i++) {
    if (buffered.start(i) <= t + 0.5 && t < buffered.end(i)) return buffered.end(i) - t
  }
  return 0
}

/**
 * What the player is waiting on, shown while it is stalled.
 *
 * A spinner alone cannot tell a slow connection from a server still transcoding
 * or one that stopped answering, and away from home that is the first thing
 * worth knowing. So this measures both halves: how fast media is piling up
 * ahead of the playhead (all sources), and — for requests the page can time,
 * which excludes a plain file the `<video>` fetches itself — how long the
 * server sat on the last chunk versus how fast it then arrived.
 */
export default function BufferingInfo({ source }: { source: StreamSource }) {
  const player = useMediaPlayer()
  const waiting = useMediaState('waiting')
  const [stall, setStall] = useState<{ since: number; now: number; rate: number | null } | null>(null)
  const [fetched, setFetched] = useState<Fetched | null>(null)
  const [fetchedAt, setFetchedAt] = useState(0)

  // Kept by an observer rather than read from the timing buffer, which stops
  // recording once full — a long episode fills it with segments.
  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return
    const observer = new PerformanceObserver(list => {
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        if (!MEDIA_REQUEST.test(e.name) || e.responseStart <= 0) continue
        const transfer = e.responseEnd - e.responseStart
        setFetched({
          wait: (e.responseStart - e.requestStart) / 1000,
          mbps: transfer > 0 && e.encodedBodySize > 0 ? (e.encodedBodySize * 8) / transfer / 1000 : null,
        })
        setFetchedAt(Date.now())
      }
    })
    observer.observe({ type: 'resource' })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!waiting || !player) return
    const since = Date.now()
    const samples: { at: number; ahead: number }[] = []
    const timer = window.setInterval(() => {
      const at = Date.now()
      const ahead = bufferedAhead(player.state.buffered, player.state.currentTime)
      samples.push({ at, ahead })
      while (at - samples[0].at > RATE_WINDOW) samples.shift()
      const first = samples[0]
      // Media seconds gained per wall second: 1 keeps up with playback.
      const rate = at - first.at >= 1000
        ? Math.max(0, (ahead - first.ahead) / ((at - first.at) / 1000))
        : null
      setStall({ since, now: at, rate })
    }, SAMPLE_EVERY)
    return () => { window.clearInterval(timer); setStall(null) }
  }, [waiting, player])

  if (!waiting || !stall || stall.now - stall.since < SHOW_AFTER) return null
  const { since, now, rate } = stall

  const stalled = Math.round((now - since) / 1000)
  const local = source.provider === DOWNLOADED_PROVIDER
  // A provider's stream played through the server's re-encode: the wait is
  // the server's, not the host's.
  const transcoded = source.kind === 'hls' && (local || Boolean(source.transcode_url))
  const what = local
    ? transcoded ? 'Your file, transcoded by the server as it plays' : 'Your file, sent as is'
    : transcoded
      ? `From ${source.provider}, re-encoded by the server as it plays`
      : `Streaming from ${source.provider}`
  const server = local || transcoded ? 'server' : source.provider
  // Only a chunk that finished during this stall describes it.
  const fresh = fetched && fetchedAt >= since ? fetched : null

  let verdict: string
  if (rate === null) verdict = 'Measuring…'
  else if (rate === 0 && !fresh) {
    verdict = transcoded
      ? `Nothing has arrived for ${stalled} s — the server is most likely still transcoding this part.`
      : `Nothing has arrived for ${stalled} s — the ${server} or your connection is not answering.`
  } else if (fresh && fresh.wait > 3) {
    verdict = `The ${server} is the slow part: it took ${fresh.wait.toFixed(1)} s to start sending the last chunk.`
  } else if (rate < 1) {
    verdict = 'Your connection is the slow part: video arrives slower than it plays.'
  } else verdict = 'Data is arriving fast enough — playback should resume shortly.'

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none max-w-[90%] rounded-lg bg-black/75 px-3 py-2 text-xs text-white/90 space-y-0.5">
      <p className="font-semibold text-white">Loading for {stalled} s</p>
      <p className="text-white/70">{what}</p>
      {rate !== null && (
        <p>Arriving at {rate.toFixed(1)}× playback speed {rate >= 1 ? '(enough)' : '(needs 1×)'}</p>
      )}
      {fresh && (
        <p>
          Last chunk: {fresh.wait.toFixed(1)} s waiting on the {server}
          {fresh.mbps !== null && `, then ${fresh.mbps.toFixed(1)} Mbit/s`}
        </p>
      )}
      <p className="text-white">{verdict}</p>
    </div>
  )
}
