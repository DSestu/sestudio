import { useState } from 'react'
import type { VideoInfo } from '../../api'
import { downloadVideo } from '../../api'
import type { LinkState } from '../../videoLinks'
import { channelHref, videoDuration, videoMeta } from '../../videoLinks'

/** A 16:9 thumbnail with its duration, or LIVE, in the corner. */
export function VideoThumb({ info, className = '' }: { info: VideoInfo; className?: string }) {
  return (
    <div className={`relative aspect-video overflow-hidden rounded-box bg-base-300 shrink-0 ${className}`}>
      {info.thumbnail && <img src={info.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />}
      {info.is_live ? (
        <span className="absolute left-1.5 top-1.5 rounded bg-error px-1.5 text-[10px] font-bold text-error-content">LIVE</span>
      ) : info.duration > 0 && (
        <span className="absolute right-1.5 bottom-1.5 rounded bg-black/80 px-1 text-[10px] tabular-nums text-white">
          {videoDuration(info.duration)}
        </span>
      )}
    </div>
  )
}

interface Props {
  link: LinkState
  /** Which site the link is on, for the label while it loads. */
  source: string
  onPlay: (info: VideoInfo) => void
}

/**
 * A pasted YouTube or Twitch link, ready to play or download. A card in the
 * desktop search panel, a bottom sheet's body on phones.
 */
export default function LinkCard({ link, source, onPlay }: Props) {
  const [queued, setQueued] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle')
  const site = source === 'twitch' ? 'Twitch' : 'YouTube'
  const { info } = link

  async function download(v: VideoInfo) {
    setQueued('busy')
    try {
      await downloadVideo(v)
      setQueued('done')
    } catch {
      setQueued('failed')
    }
  }

  return (
    <div className="flex flex-col gap-2 p-1">
      <p className="text-xs text-base-content/50">
        Link · {site} {info?.is_live ? 'live stream' : 'video'}
      </p>
      {link.error ? (
        <p role="alert" className="text-sm text-error">{link.error}</p>
      ) : !info ? (
        <div className="flex flex-col sm:flex-row gap-3" aria-busy="true" aria-label="Reading the link">
          <div className="aspect-video w-full sm:w-48 rounded-box bg-base-300 animate-pulse" />
          <div className="flex-1 flex flex-col gap-2 pt-1">
            <div className="h-4 w-3/4 rounded bg-base-300 animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-base-300 animate-pulse" />
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-3">
          <VideoThumb info={info} className="w-full sm:w-48" />
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <p className="font-semibold leading-snug line-clamp-2">{info.title}</p>
            <p className="text-xs text-base-content/60 truncate">
              {info.channel_url ? (
                <a href={channelHref(info.channel_url, info.source)} className="link link-hover font-medium text-base-content/80">
                  {info.channel}
                </a>
              ) : info.channel}
              {videoMeta({ ...info, channel: '' }) && ` · ${videoMeta({ ...info, channel: '' })}`}
            </p>
            <div className="mt-2 grid grid-cols-2 sm:flex gap-2">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onPlay(info)}>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                {info.is_live ? 'Watch' : 'Play'}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={queued === 'busy' || queued === 'done'}
                onClick={() => download(info)}
              >
                {queued === 'done' ? 'Queued' : queued === 'failed' ? 'Retry download' : info.is_live ? 'Record' : 'Download'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
