import { useEffect, useRef } from 'react'
import type { StreamSource } from '../../api'
import { useBrowserFps } from '../../browserFps'
import { useBrowserPlayerControls } from '../../browserPlayerControls'
import { isDrawn, ladderUrlOf } from '../../frameRates'
import { useMediaOptions } from '../../useMediaOptions'
import PerformancePanel, { type Mark } from '../PerformancePanel'

/** Segments of the server's own playlists: what the connection is timed on. */
const SEGMENT = /\/api\/(downloaded|stream)\/segment/

/** The performance graphs under the player, while it plays one of the
 *  server's re-encodings: at the source's rate, or drawn by AI. */
export default function BrowserPerformance({ source }: { source: StreamSource | null }) {
  const url = ladderUrlOf(source)
  const options = useMediaOptions(url ?? undefined, url !== null)
  const fps = useBrowserFps()
  const controls = useBrowserPlayerControls()

  // Speed while bytes flowed, not counting the wait for the first: that is the
  // server at work, not the connection.
  const link = useRef<number | null>(null)
  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return
    const observer = new PerformanceObserver(list => {
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        const transfer = e.responseEnd - e.responseStart
        if (SEGMENT.test(e.name) && transfer > 0 && e.encodedBodySize > 0) {
          link.current = (e.encodedBodySize * 8) / (transfer / 1000)
        }
      }
    })
    observer.observe({ type: 'resource' })
    return () => observer.disconnect()
  }, [])

  if (!url || !controls || !options) return null
  const rates = options.frame_rates
  const ai = rates.includes(fps) && isDrawn(fps, options.fps)

  /** What a quality needs at a rate: priced up for drawn frames as the
   *  server encodes them, by the square root of how many more there are. */
  const need = (height: number, rate: number) => {
    const bits = options.bandwidths[options.heights.indexOf(height)] ?? 0
    return isDrawn(rate, options.fps) ? bits * Math.sqrt(rate / options.fps) : bits
  }
  const name = (height: number, rate: number) => `${height}p${Math.round(rate)}`
  const marks = (): Mark[] => {
    const best = options.heights[0]
    if (!best) return []
    const height = options.heights.includes(controls.height()) ? controls.height() : best
    const now = rates.includes(fps) ? fps || options.fps : options.fps
    const fastest = Math.max(options.fps, ...rates)
    const found = [
      { label: `Now ${name(height, now)}`, bps: need(height, now) },
      { label: `Best quality ${name(best, now)}`, bps: need(best, now) },
      { label: `Best rate ${name(height, fastest)}`, bps: need(height, fastest) },
      { label: `Best of both ${name(best, fastest)}`, bps: need(best, fastest) },
    ]
    // One line per figure: at the best quality already, two are the same.
    return found.filter((m, i) => m.bps > 0 && found.findIndex(o => o.bps === m.bps) === i)
  }

  return (
    <PerformancePanel
      url={url}
      ai={ai}
      position={controls.position}
      clientAhead={controls.bufferedAhead}
      linkSpeed={() => link.current}
      marks={marks}
    />
  )
}
