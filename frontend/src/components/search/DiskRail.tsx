import { type RefObject, useLayoutEffect, useRef, useState } from 'react'
import { downloadedThumbUrl } from '../../api'
import { type DiskCopy, type DiskEpisode, type DiskResume, type DiskSeason, type DiskShow, plainCopy } from '../../diskShows'
import { matchKey } from '../../topMatch'
import type { WatchEntry } from '../../watchState'

interface Props {
  show: DiskShow
  history: WatchEntry[]
  /** Where the show picks up: the rail opens on it. */
  at: DiskResume
  onPlay: (copy: DiskCopy) => void
}

/** Centre *child* in its sideways-scrolling *row*, without moving the page. */
function centre(row: HTMLElement | null, child: Element | null | undefined, smooth: boolean) {
  if (!row || !(child instanceof HTMLElement)) return
  const left = child.offsetLeft - (row.clientWidth - child.offsetWidth) / 2
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  row.scrollTo({ left, behavior: smooth && !reduce ? 'smooth' : 'auto' })
}

const fade = '[mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-16px),transparent)]'

/** ‹ › for a pointer; touch scrolls the row itself. */
function Arrow({ dir, row }: { dir: -1 | 1; row: RefObject<HTMLDivElement | null> }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      onClick={() => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.8, behavior: 'smooth' })}
      className="hidden [@media(hover:hover)]:flex btn btn-ghost btn-xs btn-square shrink-0"
    >
      {dir < 0 ? '‹' : '›'}
    </button>
  )
}

/**
 * A show on disk, season by season (E1): a sideways row of seasons that opens
 * on the one you're in, and under it that season's episodes, scrolled to where
 * you left off. Only seasons with something on disk appear.
 */
export default function DiskRail({ show, history, at, onPlay }: Props) {
  const [picked, setPicked] = useState(at.season.season)
  const season = show.seasons.find(s => s.season === picked) ?? at.season
  const seasonsRow = useRef<HTMLDivElement>(null)
  const episodesRow = useRef<HTMLDivElement>(null)

  const mine = history.filter(e => matchKey(e.series) === show.key)
  // A cut numbers its episodes across the show, so its season can't be matched.
  const entryFor = (s: DiskSeason, ep: DiskEpisode) =>
    mine.find(e => e.number === ep.number && (s.cut || e.season === s.season))
  const seasonSeen = (s: DiskSeason) => s.episodes.some(ep => entryFor(s, ep))

  useLayoutEffect(() => {
    centre(seasonsRow.current, seasonsRow.current?.querySelector('[aria-pressed="true"]'), false)
  }, [])
  // Open each season on its resume point, else its start.
  useLayoutEffect(() => {
    const target = episodesRow.current?.querySelector('[data-resume]')
    if (target) centre(episodesRow.current, target, false)
    else episodesRow.current?.scrollTo({ left: 0 })
  }, [picked])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <Arrow dir={-1} row={seasonsRow} />
        <div ref={seasonsRow} role="group" aria-label="Seasons on disk" className={`flex gap-2 overflow-x-auto scroll-smooth py-1 px-4 ${fade} [scrollbar-width:none]`}>
          {show.seasons.map(s => {
            const on = s.season === season.season
            return (
              <button
                key={s.season}
                type="button"
                aria-pressed={on}
                onClick={e => { setPicked(s.season); centre(seasonsRow.current, e.currentTarget, true) }}
                className={`btn btn-sm shrink-0 rounded-full transition-colors duration-200 ease-smooth ${
                  on ? 'btn-primary' : seasonSeen(s) ? 'btn-outline btn-primary' : 'btn-ghost bg-base-100/50'
                }`}
              >
                {s.label}
              </button>
            )
          })}
        </div>
        <Arrow dir={1} row={seasonsRow} />
      </div>

      <div className="flex items-center gap-1">
        <Arrow dir={-1} row={episodesRow} />
        <div
          ref={episodesRow}
          key={season.season}
          role="list"
          aria-label={`${season.label} episodes`}
          className={`flex gap-3 overflow-x-auto snap-x px-4 pb-1 ${fade} [scrollbar-width:none] animate-slide motion-reduce:animate-none`}
        >
          {season.episodes.map(ep => {
            const entry = entryFor(season, ep)
            const resume = at.season.season === season.season && at.episode.number === ep.number
            const progress = entry && !entry.watched && entry.duration > 0 ? entry.position / entry.duration : 0
            const copy = plainCopy(ep)
            return (
              <div key={ep.number} role="listitem" data-resume={resume || undefined} className="w-40 shrink-0 snap-start">
              <button type="button" onClick={() => onPlay(copy)} className="group w-full text-left">
                <div className={`relative aspect-video overflow-hidden rounded-box bg-base-300 ring-1 transition ${resume ? 'ring-2 ring-primary' : 'ring-base-300 group-hover:ring-primary/70'}`}>
                  <img src={downloadedThumbUrl(copy.file.path)} alt="" loading="lazy" className="h-full w-full object-cover" onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
                  {entry?.watched && (
                    <span className="absolute top-1.5 right-1.5 badge badge-sm badge-success" aria-label="Watched">✓</span>
                  )}
                  {resume && <span className="absolute top-1.5 left-1.5 badge badge-sm badge-primary">{at.resume ? 'Resume' : 'Start'}</span>}
                  {ep.copies.length > 1 && (
                    <span className="absolute bottom-1.5 right-1.5 badge badge-sm badge-ghost bg-base-100/80">{ep.copies.length} copies</span>
                  )}
                  {progress > 0 && (
                    <span className="absolute inset-x-0 bottom-0 h-1 bg-base-100/60">
                      <span className="block h-full bg-primary" style={{ width: `${progress * 100}%` }} />
                    </span>
                  )}
                </div>
                <p className="mt-1.5 truncate text-xs">
                  <span className="font-mono text-base-content/50">E{ep.number}</span>{' '}
                  {/* Per-episode releases carry the whole release name; the number says enough. */}
                  {season.cut ? '' : copy.file.title}
                </p>
              </button>
              </div>
            )
          })}
        </div>
        <Arrow dir={1} row={episodesRow} />
      </div>
    </div>
  )
}
