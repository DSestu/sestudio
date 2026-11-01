// Pasted YouTube and Twitch links: which site they are on, what they point at,
// and how a video's details read.

import { useEffect, useState } from 'react'
import type { VideoInfo } from './api'
import { fetchLink } from './api'
import { timeAgo } from './notifications'

// Mirrors the hosts the server's YouTube and Twitch sites own.
const HOSTS: Record<string, string> = {
  'youtube.com': 'youtube',
  'music.youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'twitch.tv': 'twitch',
  'clips.twitch.tv': 'twitch',
}

/** 'youtube' or 'twitch' when the text is a link to one, else null. */
export function linkSource(text: string): string | null {
  try {
    return HOSTS[new URL(text.trim()).hostname.replace(/^(www|m)\./, '')] ?? null
  } catch {
    return null
  }
}

export interface LinkState {
  info?: VideoInfo
  error?: string
  loading: boolean
}

/** What a pasted link points at; null for no link. */
export function useLink(url: string | null): LinkState {
  const [state, setState] = useState<{ url: string; info?: VideoInfo; error?: string } | null>(null)
  useEffect(() => {
    if (!url) return
    let live = true
    fetchLink(url).then(
      info => { if (live) setState({ url, info }) },
      (e: Error) => { if (live) setState({ url, error: e.message }) },
    )
    return () => { live = false }
  }, [url])
  const current = url && state?.url === url ? state : null
  return { info: current?.info, error: current?.error, loading: !!url && !current }
}

export function videoDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(Math.floor(seconds % 60)).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

function views(n: number, live: boolean): string {
  const short = n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)
  return live ? `${short} watching` : `${short} views`
}

/** Channel · when · views, whichever are known. */
export function videoMeta(info: VideoInfo): string {
  return [
    info.channel,
    info.timestamp ? (info.is_live ? `live since ${timeAgo(info.timestamp).replace(' ago', '')}` : timeAgo(info.timestamp)) : null,
    info.view_count ? views(info.view_count, info.is_live) : null,
  ].filter(Boolean).join(' · ')
}

/** Where a YouTube or Twitch channel's page opens in the app. A plain link,
 *  so it works from anywhere without passing navigation down. */
export function channelHref(url: string, source: string): string {
  return `#/channel?u=${encodeURIComponent(url)}&src=${source}`
}

/** "New video every ~4 days", from the typical gap between dated uploads;
 *  '' with too few dates to say. */
export function uploadCadence(videos: VideoInfo[], noun = 'video'): string {
  const times = videos.map(v => v.timestamp).filter(Boolean).sort((a, b) => b - a)
  if (times.length < 3) return ''
  const gaps = times.slice(1).map((t, i) => times[i] - t).sort((a, b) => a - b)
  const days = gaps[Math.floor(gaps.length / 2)] / 86_400
  if (days < 1) return `several ${noun}s a day`
  const n = Math.round(days)
  return n === 1 ? `new ${noun} every day` : `new ${noun} every ~${n} days`
}
