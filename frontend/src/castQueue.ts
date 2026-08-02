import type { PlayableEpisode } from './providers'
import { getPlaybackSession, startPlayback } from './playbackSession'
import { markWatched } from './watchState'

// A cast "playlist" so autoplay can advance to the next episode when the
// current one finishes on a cast device. It lives outside React (the cast
// modal may be closed) and is driven by the persistent controllers, which
// detect end-of-media and call castEnded(). The actual cast is injected as
// `cast` so this module needs no knowledge of DLNA vs Chromecast.

interface CastQueue {
  episodes: PlayableEpisode[]
  index: number
  autoplay: boolean
  cast: (ep: PlayableEpisode) => Promise<void>
}

let queue: CastQueue | null = null
let advancing = false

export function startCastQueue(q: CastQueue) { queue = q }
export function clearCastQueue() { queue = null }
/** The active cast playlist (for pull-back to the browser player). */
export function getCastQueue(): { episodes: PlayableEpisode[]; index: number } | null {
  return queue ? { episodes: queue.episodes, index: queue.index } : null
}
export function setCastAutoplay(on: boolean) { if (queue) queue.autoplay = on }

/** Called by a controller when the current cast media ends. Advances if able. */
export async function castEnded(): Promise<void> {
  if (!queue || advancing) return
  // The episode that just finished counts as watched regardless of autoplay.
  markWatched(queue.episodes[queue.index])
  if (!queue.autoplay) return
  const next = queue.index + 1
  if (next >= queue.episodes.length) return
  advancing = true
  try {
    queue.index = next
    const ep = queue.episodes[next]
    // Keep the playback session on the same cast target for the next episode.
    const target = getPlaybackSession()?.target
    if (target && target !== 'browser') startPlayback(ep, target)
    await queue.cast(ep)
  } catch {
    // leave the session as-is; the controller keeps showing current state
  } finally {
    advancing = false
  }
}
