import type { DownloadedTitle, DownloadJob } from './api'
import { downloadedThumbUrl } from './api'
import { useDownloadedLibrary } from './downloadedLibrary'

// What Home's Downloads widget shows (docs/SPEC-home-dashboard.md §3): the
// jobs running now, then what finished since the last visit. Pure, so it is
// tested without a server.

export interface DownloadRow {
  key: string
  title: string
  poster_url: string
  /** "S2·E1 · 64%" while running, "S2·E3, E4 ready" once on disk. */
  text: string
}

const running = (j: DownloadJob) => j.status === 'queued' || j.status === 'downloading'

/** The queue's overall progress, 0–100: the mean of what is running. */
export function queueFill(jobs: DownloadJob[]): number {
  const active = jobs.filter(running)
  return active.length ? active.reduce((sum, j) => sum + j.progress, 0) / active.length : 100
}

/** Running jobs first, then titles with files newer than *lastVisit* (ms; 0
 *  on a first visit, when nothing on disk counts as new). Empty: no widget. */
export function downloadRows(jobs: DownloadJob[], downloaded: DownloadedTitle[], lastVisit: number): DownloadRow[] {
  const rows: DownloadRow[] = jobs.filter(running).map(j => {
    const ep = /S(\d+)\s*E(\d+)/i.exec(j.episode_name)
    return {
      key: j.id,
      title: j.series || j.episode_name,
      poster_url: j.poster_url ?? '',
      text: `${ep ? `S${Number(ep[1])}·E${Number(ep[2])} · ` : ''}${Math.round(j.progress)}%`,
    }
  })
  if (!lastVisit) return rows
  for (const title of downloaded) {
    const fresh = title.files.filter(f => f.mtime > lastVisit / 1000).sort((a, b) => a.number - b.number)
    if (!fresh.length) continue
    const eps = fresh.filter(f => f.number > 0).map(f => `E${f.number}`)
    rows.push({
      key: title.key,
      title: title.series,
      poster_url: title.poster_url || downloadedThumbUrl(fresh[0].path),
      text: eps.length ? `S${title.season}·${eps.join(', ')} ready` : 'Ready',
    })
  }
  return rows
}

/** The widget's data: its rows and how full the frame is. */
export function useHomeDownloads(jobs: DownloadJob[], lastVisit: number) {
  return { rows: downloadRows(jobs, useDownloadedLibrary(), lastVisit), fill: queueFill(jobs) }
}
