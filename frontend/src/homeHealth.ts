import { useCallback, useEffect, useState } from 'react'
import { getHealth, type Health, type HealthIssue } from './api'

// Home's Health: a widget when something is wrong, a footer line when all is
// good (docs/SPEC-home-dashboard.md §5). The text is pure, so it is tested
// without a server.

/** The server's health, null until it answers or when it can't (old servers
 *  answer HTML); `reload` asks again, after a retry. */
export function useHealth(): [Health | null, () => void] {
  const [health, setHealth] = useState<Health | null>(null)
  const reload = useCallback(() => { getHealth().then(setHealth) }, [])
  useEffect(reload, [reload])
  return [health, reload]
}

/** Free space in GB (10^9 bytes): whole above 10 GB, one decimal below. */
export function gbFree(bytes: number): string {
  const gb = bytes / 1e9
  return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB free`
}

function ago(iso: string, now: number): string {
  const min = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000))
  if (min < 60) return `${min} min ago`
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`
  return `${Math.floor(min / (24 * 60))} d ago`
}

const hhmm = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const disk = (h: Health) => h.disk.free_bytes != null ? [gbFree(h.disk.free_bytes)] : []

/** The footer's facts: "5 sites up · watchers ran 20 min ago · 412 GB free",
 *  leaving out what the server didn't say. */
export function okFacts(h: Health, now: number = Date.now()): string {
  const up = h.sites.filter(s => s.up).length
  return [
    ...(h.sites.length ? [`${up} ${up === 1 ? 'site' : 'sites'} up`] : []),
    ...(h.watchers.last_run_at ? [`watchers ran ${ago(h.watchers.last_run_at, now)}`] : []),
    ...disk(h),
  ].join(' · ')
}

/** The widget's facts under the worst issue: "since 14:05 · 412 GB free".
 *  A failing watcher knows when it last ran; a site or the disk, when it was checked. */
export function issueFacts(h: Health, issue: HealthIssue): string {
  const since = issue.kind === 'watcher'
    ? h.watchers.failing.find(w => String(w.id) === String(issue.id))?.since
    : issue.kind === 'site'
      ? h.sites.find(s => s.id === issue.id)?.checked_at
      : h.checked_at
  return [...(since ? [`since ${hhmm(since)}`] : []), ...disk(h)].join(' · ')
}

/** The Settings category an issue is fixed in: the disk in Downloads, a site
 *  in Sources & search; a watcher has none, so Settings opens on its list. */
export function settingsFor(issue: HealthIssue | undefined): string | undefined {
  return issue?.kind === 'disk' ? 'downloads' : issue?.kind === 'site' ? 'sources' : undefined
}
