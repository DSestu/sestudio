import { useLive } from '../liveNow'
import { useNotifications } from '../notifications'
import { useWatchers } from '../watchers'
import SourceIcon from './SourceIcon'

const CREATORS = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'twitch', label: 'Twitch' },
] as const

interface Props {
  /** `rail`: the desktop sidebar's rows; `menu`: the phone's Discover menu tiles. */
  variant: 'rail' | 'menu'
  onPick?: () => void
}

/**
 * YouTube and Twitch in Discover, always there: how many channels you follow,
 * who is live and how many new videos wait, each opening the Creators page.
 */
export default function CreatorLinks({ variant, onPick }: Props) {
  const follows = useWatchers().filter(w => w.kind === 'channel')
  const live = useLive(follows.length)
  const { events } = useNotifications()
  const current = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('src')
  const onPage = window.location.hash.startsWith('#/creators')
  const rail = variant === 'rail'

  return (
    <>
      <p className={rail
        ? 'px-2 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-base-content/40'
        : 'mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/50'}
      >
        Creators
      </p>
      <div className={rail ? 'flex flex-col gap-0.5' : 'grid grid-cols-2 gap-2'}>
        {CREATORS.map(c => {
          const followed = follows.filter(w => w.config.source === c.id).length
          const onAir = live.filter(s => s.source === c.id).length
          const fresh = events.filter(e => e.watcher_kind === 'channel' && !e.read_at && e.data.source === c.id).length
          const detail = followed
            ? [`${followed} followed`, onAir ? `${onAir} live` : null].filter(Boolean).join(' · ')
            : 'Paste a link to start'
          const isOn = onPage && current === c.id
          return (
            <a
              key={c.id}
              href={`#/creators?src=${c.id}`}
              onClick={onPick}
              aria-current={isOn ? 'page' : undefined}
              className={`flex items-center gap-2 rounded-box text-left transition-colors ${
                rail
                  ? `px-2 py-1.5 ${isOn ? 'bg-base-300 text-base-content' : 'text-base-content/60 hover:bg-base-300/60 hover:text-base-content'}`
                  : `border bg-base-300 px-2.5 py-2 ${isOn ? 'border-primary' : 'border-base-300'}`
              }`}
            >
              <SourceIcon id={c.id} label={c.label} className={rail ? 'w-5 h-5 m-0.5' : 'w-5 h-5'} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium leading-tight">{c.label}</span>
                <span className="block truncate text-[10.5px] leading-tight text-base-content/45">{detail}</span>
              </span>
              {fresh > 0 && (
                <span className="badge badge-xs border-0 bg-success/15 text-success font-semibold" aria-label={`${fresh} new`}>
                  {fresh}
                </span>
              )}
            </a>
          )
        })}
      </div>
    </>
  )
}
