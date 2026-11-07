import { castStop, useCastState } from './cast'
import { dlnaStop, useDlnaState } from './dlnaControl'
import { useCastSession } from './playbackSession'
import type { PlayableEpisode } from './providers'
import { pullBackEpisode } from './pullback'

/** The episode on the TV, the TV's name, and how to bring it back to this
 *  browser; null when no video is being cast (music casting has no session). */
export function useTvNow(): { episode: PlayableEpisode; device: string; bringBack: () => void } | null {
  const cast = useCastState()
  const dlna = useDlnaState()
  const session = useCastSession()
  const target = dlna.connected ? 'dlna' : cast.connected ? 'chromecast' : null
  if (!target || !session) return null
  const device = target === 'chromecast'
    ? cast.deviceName || session.device || 'Chromecast'
    : session.device || 'the TV'
  return {
    episode: session.episode,
    device,
    bringBack: () => target === 'dlna'
      ? pullBackEpisode(session.episode, dlna.position, dlna.duration, dlnaStop)
      : pullBackEpisode(session.episode, cast.currentTime, cast.duration, castStop),
  }
}
