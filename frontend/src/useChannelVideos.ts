import { useEffect, useState } from 'react'
import type { VideoInfo } from './api'
import { fetchChannel } from './api'

/**
 * A few more videos from a video's own channel, for the watch page's side list.
 * The open video is left out. Empty while loading, on failure, and with no
 * channel to ask about: a list that can't be filled simply isn't shown.
 */
export function useChannelVideos(channelUrl: string | undefined, exceptUrl: string): VideoInfo[] {
  const [found, setFound] = useState<{ url: string; videos: VideoInfo[] }>({ url: '', videos: [] })

  useEffect(() => {
    if (!channelUrl) return
    let cancelled = false
    fetchChannel(channelUrl)
      .then(c => { if (!cancelled) setFound({ url: channelUrl, videos: c.videos }) })
      .catch(() => { if (!cancelled) setFound({ url: channelUrl, videos: [] }) })
    return () => { cancelled = true }
  }, [channelUrl])

  // Tagged with its channel, so another video's list is never shown against this one.
  if (!channelUrl || found.url !== channelUrl) return []
  return found.videos.filter(v => v.page_url !== exceptUrl).slice(0, 8)
}
