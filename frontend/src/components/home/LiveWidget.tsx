import type { CSSProperties } from 'react'
import type { LiveStream } from '../../api'
import Widget from './Widget'

/** Rows shown before deferring to the Creators page. */
const ROWS = 3

const platform = (s: LiveStream) => (s.source === 'twitch' ? 'Twitch' : 'YouTube')

/** "Twitch · since 19:30", the start left out when unknown. */
const where = (s: LiveStream) => [
  platform(s),
  s.timestamp > 0 && `since ${new Date(s.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
].filter(Boolean).join(' · ')

/** The channel's face, ringed in red like every live avatar. */
const avatar = (s: LiveStream, size: string) => s.avatar
  ? <img src={s.avatar} alt="" className={`${size} shrink-0 rounded-full object-cover ring-2 ring-error`} />
  : <span className={`${size} shrink-0 rounded-full bg-base-300 ring-2 ring-error`} />

const playIcon = <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>

interface Props {
  live: LiveStream[]
  onWatch: (stream: LiveStream) => void
  /** The Creators page, where every followed channel is. */
  onSeeAll: () => void
  style?: CSSProperties
}

/** Live now (M): the on-air light. One stream fills the widget with its
 *  thumbnail; several are red-ringed rows. The caller leaves it out when
 *  nobody is live. */
export default function LiveWidget({ live, onWatch, onSeeAll, style }: Props) {
  const [only] = live
  const tally = (
    <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-bold tracking-[.08em] text-error">
      <i className="w-[7px] h-[7px] rounded-full bg-error shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-error)_25%,transparent)] animate-tally motion-reduce:animate-none" />
      {live.length > 1 ? `${live.length} LIVE` : 'LIVE'}
    </span>
  )

  return (
    <Widget
      size="M"
      title="Live now"
      after={tally}
      onOpen={onSeeAll}
      frame="f-live outline -outline-offset-1 outline-error/45"
      style={style}
    >
      {live.length === 1 ? (
        <>
          <div aria-hidden="true" className="absolute inset-0 -z-10">
            {only.thumbnail && <img src={only.thumbnail} alt="" className="w-full h-full object-cover" />}
            <div className="live-shade absolute inset-0" />
          </div>
          <div className="mt-auto min-w-0">
            <p className="flex items-center gap-2 text-xs min-w-0">
              {avatar(only, 'w-6 h-6')}
              <span className="font-semibold truncate">{only.channel}</span>
              <span className="text-base-content/60 truncate">{where(only)}</span>
            </p>
            <p className="mt-1.5 text-sm font-medium leading-snug text-base-content/85 line-clamp-2">{only.title}</p>
            <button type="button" onClick={() => onWatch(only)} className="btn btn-primary btn-sm gap-1.5 mt-2.5">
              {playIcon}
              Watch
            </button>
          </div>
        </>
      ) : (
        <ul className="flex flex-col gap-1">
          {live.slice(0, ROWS).map(s => (
            <li key={s.page_url}>
              <button type="button" onClick={() => onWatch(s)} className="flex w-full items-center gap-2.5 rounded-field p-1 text-left hover:bg-base-content/5">
                {avatar(s, 'w-8 h-8')}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5 min-w-0 text-sm">
                    <span className="font-medium truncate">{s.channel}</span>
                    <span className="shrink-0 text-xs text-base-content/50">{platform(s)}</span>
                  </span>
                  <span className="block text-xs text-base-content/60 truncate">{s.title}</span>
                </span>
                <span className="btn btn-primary btn-xs shrink-0" aria-hidden="true">Watch</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  )
}
