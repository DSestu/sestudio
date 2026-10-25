import { useState } from 'react'
import { downloadedThumbUrl } from '../../api'
import { type DiskCopy, type DiskShow, type EpisodeHit, episodeCode } from '../../diskShows'

interface Props {
  groups: { show: DiskShow; hits: EpisodeHit[] }[]
  onPlay: (copy: DiskCopy) => void
  /** The show's own page, from one of its copies. */
  onOpenShow: (copy: DiskCopy) => void
}

const fold = (open: boolean) =>
  `grid transition-[grid-template-rows,opacity] duration-[240ms] ease-smooth motion-reduce:transition-none ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr] opacity-0'}`

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 shrink-0 text-base-content/50 transition-transform duration-[240ms] ease-smooth ${open ? 'rotate-180' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function Thumb({ copy, className }: { copy: DiskCopy; className: string }) {
  return (
    <span className={`overflow-hidden rounded bg-base-300 ${className}`}>
      <img src={downloadedThumbUrl(copy.file.path)} alt="" loading="lazy" className="h-full w-full object-cover" onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
    </span>
  )
}

const code = (hit: EpisodeHit) => (hit.season.label === 'Film' ? 'Film' : episodeCode(hit.season, hit.episode))

function HitRow({ hit, onPlay }: { hit: EpisodeHit; onPlay: Props['onPlay'] }) {
  return (
    <li>
      <button type="button" onClick={() => onPlay(hit.copy)} className="group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-base-300/60">
        <Thumb copy={hit.copy} className="w-20 aspect-video shrink-0" />
        <span className="w-16 shrink-0 font-mono text-xs text-base-content/50">{code(hit)}</span>
        <span className="min-w-0 flex-1 truncate text-sm">{hit.copy.file.title}</span>
        <span className="btn btn-ghost btn-xs btn-circle text-primary opacity-60 group-hover:opacity-100" aria-hidden="true">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
        </span>
      </button>
    </li>
  )
}

/** Show › season › episode, each level folding on its own. */
function Tree({ groups, onPlay }: Pick<Props, 'groups' | 'onPlay'>) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  return (
    <ul className="flex flex-col">
      {groups.map(({ show, hits }) => {
        const seasons = [...new Set(hits.map(h => h.season))]
        return (
          <li key={show.key}>
            <button type="button" aria-expanded={open.has(show.key)} onClick={() => toggle(show.key)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left font-medium hover:bg-base-300/60">
              <Chevron open={open.has(show.key)} />
              {show.name} <span className="text-xs font-normal text-base-content/50">{hits.length}</span>
            </button>
            <div className={fold(open.has(show.key))} inert={!open.has(show.key)}>
              <ul className="min-h-0 overflow-hidden pl-5">
                {seasons.map(season => {
                  const id = `${show.key}|${season.season}`
                  const mine = hits.filter(h => h.season === season)
                  return (
                    <li key={id}>
                      <button type="button" aria-expanded={open.has(id)} onClick={() => toggle(id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm hover:bg-base-300/60">
                        <Chevron open={open.has(id)} />
                        {season.label} <span className="text-xs text-base-content/50">{mine.length}</span>
                      </button>
                      <div className={fold(open.has(id))} inert={!open.has(id)}>
                        <ul className="min-h-0 overflow-hidden pl-5">
                          {mine.map(hit => <HitRow key={hit.episode.number} hit={hit} onPlay={onPlay} />)}
                        </ul>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Episodes on disk whose own title matches the search (E3): a band that says
 * how many and from which shows, opening on the episodes grouped by show — or
 * as a show › season › episode tree when one show has hits all over.
 */
export default function EpisodeHits({ groups, onPlay, onOpenShow }: Props) {
  const [open, setOpen] = useState(false)
  // Many hits in many seasons of one show read better folded by season.
  const sprawling = groups.some(g => g.hits.length > 10 && new Set(g.hits.map(h => h.season)).size > 3)
  const [tree, setTree] = useState(sprawling)
  const all = groups.flatMap(g => g.hits)
  const summary = groups.map(g => (g.hits.length > 1 ? `${g.show.name} ×${g.hits.length}` : g.show.name)).join(' · ')

  return (
    <section aria-label="Episodes on your disk" className="rounded-box border border-success/30 bg-success/5">
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <svg className="w-5 h-5 shrink-0 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 1.1.9 2 2 2h12a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H6a2 2 0 00-2 2z" />
        </svg>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold">Episodes on your disk · {all.length}</span>
          <span className="truncate text-xs text-base-content/60">{summary}</span>
        </span>
        {/* A fan of the first stills: what's behind the band, at a glance. */}
        <span className="hidden sm:flex -space-x-6" aria-hidden="true">
          {all.slice(0, 4).map((hit, i) => (
            <Thumb key={i} copy={hit.copy} className="w-14 aspect-video ring-2 ring-base-100" />
          ))}
        </span>
        <Chevron open={open} />
      </button>

      <div className={fold(open)} inert={!open}>
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-2 px-2 pb-3">
            <div className="flex justify-end px-1">
              <div role="group" aria-label="Layout" className="join">
                <button type="button" aria-pressed={!tree} onClick={() => setTree(false)} className={`join-item btn btn-xs ${tree ? 'btn-ghost' : 'btn-active'}`}>Grouped</button>
                <button type="button" aria-pressed={tree} onClick={() => setTree(true)} className={`join-item btn btn-xs ${tree ? 'btn-active' : 'btn-ghost'}`}>Tree</button>
              </div>
            </div>
            {tree ? <Tree groups={groups} onPlay={onPlay} /> : (
              <div className="flex flex-col gap-3">
                {groups.map(({ show, hits }) => (
                  <div key={show.key}>
                    <div className="flex items-baseline gap-2 px-2 pb-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-base-content/50">
                        {show.name} <span className="font-mono">{hits.length}</span>
                      </p>
                      <button type="button" onClick={() => onOpenShow(hits[0].copy)} className="ml-auto text-xs text-primary hover:underline">Open show ›</button>
                    </div>
                    <ul className="flex flex-col">
                      {hits.map(hit => <HitRow key={`${hit.season.season}|${hit.episode.number}`} hit={hit} onPlay={onPlay} />)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
