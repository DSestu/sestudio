import { useEffect, useState } from 'react'
import { mediaOptions, type MediaOptions } from './api'

/** How soon to ask again while the server fetches the AI runtime. */
const RETRY_MS = 5000

// Answers kept per URL once final, so the player and the pickers beside it
// share one request. Not while preparing: those are asked again.
const known = new Map<string | undefined, MediaOptions>()

/** Drop the answers kept, so the next ask sees AI turned on or off. */
export function forgetMediaOptions() {
  known.clear()
}

/** The options of the media at *url* (without one, of what was last sent to a
 *  DLNA TV), or null until known. Asked again every few seconds while the
 *  server is still fetching the AI runtime on first use, so the frame rates it
 *  draws appear once it can. Keyed on *url*: another video starts over. */
export function useMediaOptions(url: string | undefined, enabled = true): MediaOptions | null {
  const [found, setFound] = useState<{ url: string | undefined; value: MediaOptions } | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    let timer = 0
    // Not cached without a URL: that is whatever the TV was last sent.
    const cached = url === undefined ? undefined : known.get(url)
    const ask = () => (cached ? Promise.resolve(cached) : mediaOptions(url)).then(value => {
      if (!live) return
      setFound({ url, value })
      if (value.preparing) timer = window.setTimeout(ask, RETRY_MS)
      else if (url !== undefined) known.set(url, value)
    })
    ask()
    return () => { live = false; window.clearTimeout(timer) }
  }, [url, enabled])
  return found && found.url === url ? found.value : null
}
