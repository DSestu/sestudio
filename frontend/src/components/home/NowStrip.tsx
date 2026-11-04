import { useEffect, useState, type ReactNode } from 'react'
import type { DownloadedFile, DownloadedTitle, DownloadJob, HealthIssue, UpcomingEpisode } from '../../api'
import { downloadedThumbUrl, getHealth, getUpcoming, pollWatcher, retryHealthSite, videoSeasonCard } from '../../api'
import { useDownloadedLibrary } from '../../downloadedLibrary'
import { localDay, nowItems, type NowItem } from '../../homeNow'
import { settingsFor } from '../../homeHealth'
import { useLive } from '../../liveNow'
import type { Navigate } from '../../nav'
import { cardFor, type OpenTitle } from '../../rowItems'
import { useWatchers } from '../../watchers'

interface Props {
  /** When Home was last seen (ms), from useLastVisit. */
  lastVisit: number
  jobs: DownloadJob[]
  lang: string
  onOpen: OpenTitle
  onNavigate: Navigate
  onOpenDownloaded: (title: DownloadedTitle, file?: DownloadedFile) => void
  onSearchTerm: (term: string) => void
}

const alertIcon = (tone: string) => (
  <svg className={`ml-1.5 w-5 h-5 shrink-0 ${tone}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
  </svg>
)

const poster = (url: string | null) => url
  ? <img src={url} alt="" className="w-[22px] h-[33px] shrink-0 rounded-[3px] object-cover outline outline-1 -outline-offset-1 outline-base-content/10" />
  : <span className="w-[22px] h-[33px] shrink-0 rounded-[3px] bg-base-300" />

/** Home's top row: one chip per thing that needs you now, each with one
 *  action; absent when there is none (docs/SPEC-home-dashboard.md §4). */
export default function NowStrip({ lastVisit, jobs, lang, onOpen, onNavigate, onOpenDownloaded, onSearchTerm }: Props) {
  const live = useLive(useWatchers().filter(w => w.kind === 'channel').length)
  const downloaded = useDownloadedLibrary()
  const [upcoming, setUpcoming] = useState<UpcomingEpisode[]>([])
  const [issues, setIssues] = useState<HealthIssue[]>([])
  const [busy, setBusy] = useState('')

  const loadHealth = () => getHealth().then(h => setIssues(h?.issues ?? []))
  useEffect(() => {
    getUpcoming().then(setUpcoming)
    loadHealth()
  }, [])

  const items = nowItems({ live, upcoming, downloaded, jobs, issues, today: localDay() }, lastVisit)
  if (!items.length) return null

  const openEpisode = (e: UpcomingEpisode) => e.page_url
    ? onOpen(cardFor(e.series, e.season ?? 1, e.poster_url ?? '', e.page_url, e.source ?? undefined), 0, e.lang || lang)
    : onSearchTerm(e.series)

  const retry = (item: NowItem, issue: HealthIssue) => {
    setBusy(item.key)
    const call = issue.retry === 'site' ? retryHealthSite(issue.id!) : pollWatcher(Number(issue.id))
    call.catch(() => {}).then(loadHealth).finally(() => setBusy(''))
  }

  // What each chip shows before its text, what its text opens, and its action.
  const parts = (item: NowItem): { thumb: ReactNode; open: () => void; action: string; act: () => void } => {
    switch (item.kind) {
      case 'live': {
        const watch = () => onOpen(videoSeasonCard(item.stream), 0, lang)
        return {
          thumb: item.stream.avatar
            ? <img src={item.stream.avatar} alt="" className="w-7 h-7 shrink-0 rounded-full object-cover ring-2 ring-error" />
            : <span className="w-7 h-7 shrink-0 rounded-full bg-base-300 ring-2 ring-error" />,
          open: watch, action: 'Watch', act: watch,
        }
      }
      case 'airs': {
        const open = () => openEpisode(item.episode)
        return { thumb: poster(item.episode.poster_url), open, action: 'Open', act: open }
      }
      case 'ready':
        return {
          thumb: poster(item.title.poster_url || downloadedThumbUrl(item.file.path)),
          open: () => onNavigate('media'),
          action: 'Play',
          act: () => onOpenDownloaded(item.title, item.file),
        }
      case 'failed': {
        // shortcut: no retry endpoint for a job; the queue is where to redo it.
        const open = () => onNavigate('media', { tab: 'queue' })
        return { thumb: alertIcon('text-error'), open, action: 'View', act: open }
      }
      case 'health': {
        const { issue } = item
        const open = () => onNavigate('settings', { s: settingsFor(issue) })
        return issue.retry && issue.id
          ? { thumb: alertIcon('text-warning'), open, action: 'Retry', act: () => retry(item, issue) }
          : { thumb: alertIcon('text-warning'), open, action: 'Settings', act: open }
      }
    }
  }

  return (
    <ul className="flex gap-2 overflow-x-auto no-scrollbar" aria-label="Now">
      {items.map(item => {
        const { thumb, open, action, act } = parts(item)
        return (
          <li key={item.key} className="flex shrink-0 items-center gap-2 h-10 px-1.5 rounded-full bg-base-200 text-[13px] font-medium whitespace-nowrap">
            <button type="button" onClick={open} className="flex items-center gap-2 h-full rounded-full focus-visible:outline-2 focus-visible:outline-primary">
              {thumb}
              <span>{item.text}</span>
            </button>
            <button
              type="button"
              onClick={act}
              disabled={busy === item.key}
              className="h-7 px-2.5 rounded-full bg-base-content/10 text-xs hover:bg-base-content/15 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-primary"
            >
              {action}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
