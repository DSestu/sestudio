import { useState, type CSSProperties } from 'react'
import type { UpcomingEpisode } from '../../api'
import { localDay } from '../../homeNow'
import { cardFor, type OpenTitle } from '../../rowItems'
import { episodeLabel, upcomingNote, upcomingSentence, vfWatcher } from '../../upcoming'
import { addWatcher, useWatchers } from '../../watchers'
import Widget from './Widget'

/** Rows the widget lists; the rest are under Activity's watchers. */
const ROWS = 3

interface Props {
  episodes: UpcomingEpisode[]
  lang: string
  onOpen: OpenTitle
  onSearchTerm: (term: string) => void
  onSeeAll: () => void
  style?: CSSProperties
}

const bell = (on: boolean) => (
  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M18 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h16l-1.4-1.4a2 2 0 01-.6-1.4z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17a3 3 0 11-6 0" />
  </svg>
)

/** A dashed calendar leaf: weekday over day number. Today's is blue. */
function DayTile({ day, today, large }: { day: string; today: string; large?: boolean }) {
  const date = new Date(`${day}T00:00`)
  return (
    <span className={`shrink-0 text-center rounded-md outline-1 outline-dashed outline-base-400 -outline-offset-1 ${large ? 'w-14 py-2' : 'w-10 py-1'} ${day === today ? 'text-primary' : ''}`}>
      <span className="block text-[10px] leading-3 uppercase opacity-50">{date.toLocaleDateString('en', { weekday: 'short' })}</span>
      <span className={`block font-semibold leading-tight ${large ? 'text-[22px]' : 'text-base'}`}>{date.getDate()}</span>
    </span>
  )
}

/** Followed series' episodes airing this week: dashed, because they don't
 *  exist yet (docs/SPEC-home-dashboard.md §3, §6). */
export default function UpcomingWidget({ episodes, lang, onOpen, onSearchTerm, onSeeAll, style }: Props) {
  const watchers = useWatchers()
  const [busy, setBusy] = useState(0)
  const today = localDay()

  const open = (e: UpcomingEpisode) => e.page_url
    ? onOpen(cardFor(e.series, e.season ?? 1, e.poster_url ?? '', e.page_url, e.source ?? undefined), 0, e.lang || lang)
    : onSearchTerm(e.series)

  // Asks the series' page watcher for VF only; one already covering VF (or
  // every language) shows the bell lit instead.
  const vfButton = (e: UpcomingEpisode, long: boolean) => {
    if (!e.page_url) return null
    const on = Boolean(vfWatcher(watchers, e))
    const watch = () => {
      setBusy(e.tmdb_id)
      addWatcher({
        kind: 'series_episodes',
        label: e.series,
        config: { page_url: e.page_url, source: e.source ?? '', langs: ['vf'], series_name: e.series, poster_url: e.poster_url ?? '' },
      }).catch(() => {}).finally(() => setBusy(0))
    }
    return (
      <button
        type="button"
        disabled={on || busy === e.tmdb_id}
        onClick={watch}
        aria-label={on ? `Watching ${e.series} for VF` : `Tell me when ${e.series} is in VF`}
        title={on ? 'Watching for VF, reported under Activity' : 'Tell me when it is in VF'}
        className={`btn btn-ghost btn-sm shrink-0 gap-1.5 ${on ? 'disabled:bg-transparent disabled:text-primary' : ''}`}
      >
        {busy === e.tmdb_id ? <span className="loading loading-spinner loading-xs" /> : bell(on)}
        {long ? (on ? 'Watching for VF' : "Tell me when it's in VF") : 'VF'}
      </button>
    )
  }

  const one = episodes.length === 1 ? episodes[0] : null

  return (
    <Widget
      style={style}
      size="M"
      title="Upcoming"
      sub="next 7 days"
      onOpen={onSeeAll}
      frame="f-up bg-transparent! outline-1 outline-dashed outline-base-400 -outline-offset-1"
    >
      {one ? (
        <div className="flex flex-1 min-h-0 gap-4 items-center">
          <button type="button" onClick={() => open(one)} className="shrink-0 h-full max-h-44 aspect-[2/3] rounded-md outline-1 outline-dashed outline-base-400 outline-offset-[3px]">
            {one.poster_url
              ? <img src={one.poster_url} alt="" className="w-full h-full rounded-md object-cover opacity-35 grayscale-[.6]" />
              : <span className="block w-full h-full rounded-md bg-base-300" />}
          </button>
          <div className="flex flex-col gap-2 min-w-0 items-start">
            <DayTile day={one.air_date} today={today} large />
            <button type="button" onClick={() => open(one)} className="text-left text-[17px] font-semibold leading-snug tracking-tight hover:underline">
              {one.series} <span className="text-base-content/50">{episodeLabel(one)}</span>
            </button>
            <p className="text-sm text-base-content/60">{upcomingSentence(one, today)}</p>
            {vfButton(one, true)}
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2 min-h-0">
          {episodes.slice(0, ROWS).map(e => (
            <li key={e.tmdb_id} className="flex items-center gap-3 min-w-0">
              <DayTile day={e.air_date} today={today} />
              <button type="button" onClick={() => open(e)} className="flex-1 min-w-0 text-left">
                <span className="block truncate text-sm font-medium">
                  {e.series} <span className="text-base-content/50">{episodeLabel(e)}</span>
                </span>
                <span className="block truncate text-xs text-base-content/50">{upcomingNote(e)}</span>
              </button>
              {vfButton(e, false)}
            </li>
          ))}
        </ul>
      )}
    </Widget>
  )
}
