import { useEffect, useState } from 'react'
import type { VideoInfo } from './api'
import { fetchCreatorsLatest } from './api'

// Home's "From your channels" widget (docs/SPEC-home-dashboard.md §3): the
// latest videos of followed channels, split at the last visit.

/** Faces the widget's header stacks at most. */
export const FACE_LIMIT = 4

export interface ChannelsSummary {
  /** Newest first, live streams left out: Live now covers them. */
  videos: VideoInfo[]
  /** Videos uploaded since the last visit. */
  fresh: number
  /** Channel URLs the header's faces stand for: those with new uploads, or
   *  when nothing is new, those of the latest videos. */
  faces: string[]
}

/** *lastVisit* in ms, as useLastVisit gives it; 0 (a first visit) makes nothing new. */
export function summarizeChannels(latest: VideoInfo[], lastVisit: number): ChannelsSummary {
  const videos = latest.filter(v => !v.is_live)
  const isNew = (v: VideoInfo) => lastVisit > 0 && v.timestamp * 1000 > lastVisit
  const fresh = videos.filter(isNew)
  const faces = [...new Set((fresh.length ? fresh : videos).map(v => v.channel_url))].slice(0, FACE_LIMIT)
  return { videos, fresh: fresh.length, faces }
}

/** The latest videos across followed channels; null while loading. A failed
 *  fetch gives none, so the widget is absent rather than a skeleton forever. */
export function useChannelsLatest(follows: number): VideoInfo[] | null {
  const [latest, setLatest] = useState<VideoInfo[] | null>(null)
  useEffect(() => {
    if (!follows) return
    let alive = true
    fetchCreatorsLatest()
      .then(v => { if (alive) setLatest(v) })
      .catch(() => { if (alive) setLatest([]) })
    return () => { alive = false }
  }, [follows])
  return follows ? latest : []
}
