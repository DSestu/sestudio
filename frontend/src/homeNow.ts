import type {
  DownloadedFile, DownloadedTitle, DownloadJob, HealthIssue, LiveStream, UpcomingEpisode,
} from './api'

// What Home's Now strip shows: the few things that need you right now, in a
// fixed order (docs/SPEC-home-dashboard.md §4). Pure, so the order is tested
// without a server.

/** Chips the strip holds at most; the rest of Home has the full lists. */
export const NOW_LIMIT = 6

export type NowItem = { key: string; text: string } & (
  | { kind: 'live'; stream: LiveStream }
  | { kind: 'airs'; episode: UpcomingEpisode }
  | { kind: 'ready'; title: DownloadedTitle; file: DownloadedFile }
  | { kind: 'failed'; jobs: DownloadJob[] }
  | { kind: 'health'; issue: HealthIssue }
)

export interface NowInput {
  live: LiveStream[]
  upcoming: UpcomingEpisode[]
  downloaded: DownloadedTitle[]
  jobs: DownloadJob[]
  issues: HealthIssue[]
  /** Today as YYYY-MM-DD, local time. */
  today: string
}

/** Local date as YYYY-MM-DD, the form TMDB air dates come in. */
export function localDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The strip's chips: live, airs today, downloads ready, downloads failed,
 *  Health issues. *lastVisit* (ms) is when Home was last seen; 0, a first
 *  visit, counts nothing on disk as new. */
export function nowItems(input: NowInput, lastVisit: number): NowItem[] {
  const since = lastVisit / 1000
  const items: NowItem[] = []

  for (const stream of input.live) {
    items.push({ kind: 'live', key: `live-${stream.page_url}`, text: `${stream.channel} is live`, stream })
  }

  for (const episode of input.upcoming) {
    if (episode.air_date !== input.today) continue
    const ep = episode.episode != null ? ` S${episode.season ?? 1}·E${episode.episode}` : ''
    items.push({ kind: 'airs', key: `airs-${episode.tmdb_id}`, text: `${episode.series}${ep} airs today`, episode })
  }

  if (lastVisit) {
    for (const title of input.downloaded) {
      const fresh = title.files.filter(f => f.mtime > since).sort((a, b) => a.number - b.number)
      if (!fresh.length) continue
      const eps = fresh.filter(f => f.number > 0).map(f => `E${f.number}`)
      items.push({
        kind: 'ready',
        key: `ready-${title.key}`,
        text: `${title.series}${eps.length ? ` ${eps.join(', ')}` : ''} ready`,
        title,
        // Play starts at the first new one.
        file: fresh[0],
      })
    }

    const failed = input.jobs.filter(j => j.status === 'failed' && (j.finished_at ?? 0) > since)
    if (failed.length) {
      items.push({
        kind: 'failed',
        key: 'failed',
        text: failed.length === 1
          ? `Download failed: ${failed[0].episode_name}`
          : `${failed.length} downloads failed`,
        jobs: failed,
      })
    }
  }

  for (const issue of input.issues) {
    items.push({ kind: 'health', key: `health-${issue.kind}-${issue.id ?? issue.message}`, text: issue.message, issue })
  }

  return items.slice(0, NOW_LIMIT)
}
