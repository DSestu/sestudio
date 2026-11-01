import { channelHref } from '../videoLinks'
import { useWatchers } from '../watchers'

interface Props {
  /** `rail`: the desktop sidebar's compact rows; `menu`: the phone's Discover menu. */
  variant: 'rail' | 'menu'
  /** Channel page open now, marked as current. */
  currentUrl?: string
  /** Only this site's channels ('youtube' or 'twitch'); all when absent. */
  source?: string
  onPick?: () => void
}

/** The YouTube and Twitch channels you follow, each a link to its page. */
export default function FollowedChannels({ variant, currentUrl, source, onPick }: Props) {
  const channels = useWatchers()
    .filter(w => w.kind === 'channel' && (!source || w.config.source === source))
    .map(w => ({
      id: w.id,
      url: String(w.config.channel_url ?? ''),
      source: String(w.config.source ?? ''),
      name: String(w.config.name || w.label),
      avatar: String(w.config.avatar ?? ''),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  if (!channels.length) return null
  const rail = variant === 'rail'

  return (
    <>
      <p className={rail
        ? 'px-2 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-base-content/40'
        : 'mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/50'}
      >
        Following
      </p>
      <div className={rail ? 'flex flex-col gap-0.5' : 'grid grid-cols-2 gap-2'}>
        {channels.map(c => (
          <a
            key={c.id}
            href={channelHref(c.url, c.source)}
            onClick={onPick}
            aria-current={c.url === currentUrl ? 'page' : undefined}
            className={`flex items-center gap-2 rounded-box text-left transition-colors ${
              rail
                ? `px-2 py-1.5 text-[13px] ${c.url === currentUrl ? 'bg-base-300 text-base-content' : 'text-base-content/60 hover:bg-base-300/60 hover:text-base-content'}`
                : 'border border-base-300 bg-base-300 px-2.5 py-2 text-sm font-medium'
            }`}
          >
            {c.avatar
              ? <img src={c.avatar} alt="" loading="lazy" className="w-6 h-6 shrink-0 rounded-full object-cover" />
              : <span className="w-6 h-6 shrink-0 rounded-full bg-base-100" />}
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            <span className="text-[10px] text-base-content/40">{c.source === 'twitch' ? 'Twitch' : 'YouTube'}</span>
          </a>
        ))}
      </div>
    </>
  )
}
