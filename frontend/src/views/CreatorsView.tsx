import { useEffect, useState } from 'react'
import type { SeasonCard, VideoInfo } from '../api'
import { fetchCreatorsLatest } from '../api'
import FollowSearch from '../components/FollowSearch'
import PageHeader from '../components/PageHeader'
import ImportFollows from '../components/ImportFollows'
import FollowedChannels from '../components/FollowedChannels'
import LiveNow from '../components/LiveNow'
import VideoGrid from '../components/VideoGrid'
import type { Navigate } from '../nav'
import { useWatchers } from '../watchers'

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'twitch', label: 'Twitch' },
]

interface Props {
  /** 'youtube' or 'twitch' to show one site only; '' for both. */
  source: string
  onOpen: (card: SeasonCard) => void
  navigate: Navigate
}

/**
 * YouTube and Twitch in one place: who is live, the channels you follow, and
 * their newest videos. Without any follows yet, it says how to start.
 */
export default function CreatorsView({ source, onOpen, navigate }: Props) {
  const follows = useWatchers().filter(w => w.kind === 'channel')
  const [latest, setLatest] = useState<{ videos?: VideoInfo[]; error?: string } | null>(null)

  useEffect(() => {
    if (!follows.length) return
    let alive = true
    fetchCreatorsLatest().then(
      videos => { if (alive) setLatest({ videos }) },
      (e: Error) => { if (alive) setLatest({ error: e.message }) },
    )
    return () => { alive = false }
  }, [follows.length])

  const shown = (latest?.videos ?? []).filter(v => !source || v.source === source)
  const site = FILTERS.find(f => f.value === source)?.label ?? 'All'

  return (
    <div className="flex flex-col gap-6">
      {/* Phones: the page name, how many channels are followed and the site tabs live in the top card. */}
      <PageHeader
        title="YouTube &amp; Twitch"
        status={follows.length ? <><em className="not-italic text-primary font-semibold">{follows.length}</em> followed</> : undefined}
        tabs={FILTERS.map(f => ({ id: f.value || 'all', label: f.label }))}
        tab={source || 'all'}
        onTab={id => navigate('creators', { src: id === 'all' ? undefined : id })}
      />
      <header className="max-md:hidden flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold tracking-tight flex-1">YouTube &amp; Twitch</h2>
        <div role="radiogroup" aria-label="Site" className="flex gap-1">
          {FILTERS.map(f => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={f.value === source}
              onClick={() => navigate('creators', { src: f.value || undefined })}
              className={`btn btn-sm rounded-full ${f.value === source ? 'btn-primary' : 'btn-ghost'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      {/* The way in comes first: with no follows it is the whole page. */}
      <FollowSearch source={source} autoFocus={!follows.length} />

      {follows.length > 0 && (
        <>
          {source !== 'youtube' && <LiveNow onOpen={onOpen} followLink={false} />}

          <FollowedChannels source={source || undefined} />

          <section aria-labelledby="creators-latest" className="flex flex-col gap-3">
            <h3 id="creators-latest" className="text-lg font-semibold tracking-tight">Latest videos</h3>
            {!latest ? (
              <div aria-busy="true" aria-label="Loading the latest videos" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="aspect-video rounded-box bg-base-300 animate-pulse motion-reduce:animate-none" />
                ))}
              </div>
            ) : latest.error ? (
              <p role="alert" className="text-sm text-error">{latest.error}</p>
            ) : shown.length ? (
              <VideoGrid videos={shown} onOpen={onOpen} showChannel />
            ) : (
              <p className="text-sm text-base-content/50">No recent videos from the {site === 'All' ? '' : `${site} `}channels you follow.</p>
            )}
          </section>
        </>
      )}

      <details className="group max-w-xl rounded-box border border-base-300 px-4 py-3" open={!follows.length}>
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <svg className="w-4 h-4 transition-transform group-open:rotate-90 motion-reduce:transition-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
          </svg>
          Import many at once
          <span className="font-normal text-base-content/50 max-sm:hidden">: your YouTube subscriptions, or a list of Twitch names</span>
        </summary>
        <div className="mt-4">
          <ImportFollows />
        </div>
      </details>
    </div>
  )
}
