import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import { hitPayload, sourceLabel, useMusicSearch, type OnlineHit } from '../../../musicSearch'
import { dragProps } from '../edit/focus'
import { trackOfHit } from '../edit/onlineAnalysis'
import { fmtTime } from '../format'
import { playPayload, reducedMotion } from '../player'
import { Lit, Row, type TreeHandlers } from './ExplorerTree'
import { Ic } from './icons'
import { mergeOnline, songKey, type Song } from './onlineMerge'
import type { Query } from './searchWords'

// The explorer's Online section while the search has name words (B in
// docs/proto/music/online-search.html): one row per song, merged across the sites, previews
// left out; loops and off-topic results fold into one row.

/** The chip naming where a song plays from. */
const SHORT: Record<string, string> = { ytmusic: 'YTM', youtube: 'YT', soundcloud: 'SC' }
/** Online search waits for typing to pause this long. */
const ONLINE_DELAY = 550
const EASE = 'cubic-bezier(.2, .8, .2, 1)'

export function OnlineSection({ query, matched, h }: {
  query: Query
  /** The library tracks that answer the query: an online song you own plays your copy. */
  matched: MusicTrack[]
  h: TreeHandlers
}) {
  const online = useMusicSearch(query.terms.join(' '), 'all', ONLINE_DELAY)
  const [open, setOpen] = useState(false)
  const hits = useMemo(() => {
    const seen = new Set<string>()
    return (online?.res.online ?? []).filter(x => !seen.has(x.track_id) && seen.add(x.track_id))
  }, [online])
  const merged = useMemo(() => mergeOnline(hits, query.terms), [hits, query.terms])
  const mine = useMemo(() => new Map(matched.map(t => [songKey(t.title), t])), [matched])
  const rest = [...merged.long, ...merged.other]
  const errors = Object.entries(online?.res.errors ?? {}).filter(([k]) => k !== 'library')
  const n = merged.songs.length
  const list = useRef<HTMLDivElement>(null)
  useGlide(list)
  return (
    <>
      <p className="truncate px-3 pb-1 text-[11px] text-base-content/60">
        {/* The pending part first: the column truncates the line. */}
        {!online ? 'searching…' : `${n} ${n === 1 ? 'song' : 'songs'} · ${online.pending.length ? 'more coming' : 'merged, previews left out'}`}
      </p>
      <div ref={list} className="relative">
        {merged.songs.map(s => <div key={s.key} data-ids={s.hits.map(x => x.track_id).join(' ')}><SongRow s={s} own={mine.get(s.key)} h={h} terms={query.terms} /></div>)}
      </div>
      {online && !online.pending.length && !n && <p className="px-3 py-1.5 text-xs text-base-content/60">Nothing online</p>}
      {rest.length > 0 && (open
        ? rest.map(x => <OnlineRow key={x.track_id} hit={x} h={h} />)
        : <Row depth={0} icon={null} onClick={() => setOpen(true)} dim
            label={[merged.long.length && `${merged.long.length} long ${merged.long.length === 1 ? 'version' : 'versions'}`, merged.other.length && `${merged.other.length} other ${merged.other.length === 1 ? 'result' : 'results'}`].filter(Boolean).join(' · ')} />)}
      {errors.length > 0 && <p className="px-2 py-1 text-[11px] text-error/80">{errors.map(([k, v]) => `${sourceLabel(k)}: ${v}`).join(' · ')}</p>}
    </>
  )
}

/** Where a row shows now: its slot plus whatever glide is still moving it. */
const shownY = (el: HTMLElement, slot: number) => slot + (parseFloat(getComputedStyle(el).translate.split(' ')[1] ?? '') || 0)

/**
 * As sites answer, songs arrive and re-sort. A row is known by the site results in it, not its
 * title (a late artist can retitle and remount it): one holding a result seen before glides from
 * where that result showed (FLIP, from mid-glide too); a new one settles in, already visible.
 * A row climbing passes over the ones it overtakes, which dim while they slide down.
 * Reduced motion: nothing animates.
 */
function useGlide(ref: React.RefObject<HTMLDivElement | null>) {
  const last = useRef(new Map<string, { slot: number; el: HTMLElement }>())
  useLayoutEffect(() => {
    const now = new Map<string, { slot: number; el: HTMLElement }>()
    const still = reducedMotion()
    const rows = [...ref.current?.children ?? []].map(el => {
      const row = el as HTMLElement, ids = row.dataset.ids!.split(' '), top = row.offsetTop
      const prev = ids.map(id => last.current.get(id)).find(Boolean)
      const was = prev && (prev.el.isConnected ? shownY(prev.el, prev.slot) : prev.slot)
      ids.forEach(id => now.set(id, { slot: top, el: row }))
      return { row, top, was }
    })
    for (const { row, top, was } of rows) {
      if (was === undefined) {
        if (!still) row.animate([{ opacity: 0.4, translate: '0 -3px' }, { opacity: 1, translate: '0 0' }], { duration: 140, easing: EASE })
      } else if (!still && Math.abs(was - top) > 0.5) {
        row.getAnimations().forEach(a => a.cancel())
        const up = was > top
        row.style.zIndex = up ? '1' : ''
        row.style.position = 'relative'
        row.animate(up ? [{ translate: `0 ${was - top}px` }, { translate: '0 0' }] : [{ translate: `0 ${was - top}px`, opacity: 0.6 }, { translate: '0 0', opacity: 1 }], { duration: 180, easing: EASE })
          .onfinish = () => { row.style.zIndex = '' }
      }
    }
    last.current = now
  })
}

/** A merged song: plays from its best source; one you own plays and adds your copy. */
function SongRow({ s, own, h, terms }: { s: Song; own?: MusicTrack; h: TreeHandlers; terms: string[] }) {
  const t = own ?? trackOfHit(s.best)
  const dur = s.duration ? fmtTime(s.duration) : ''
  const also = [...new Set(s.hits.map(x => x.source))].filter(x => x !== s.best.source).map(sourceLabel)
  return (
    <Row
      depth={0}
      icon={s.best.thumb ? <img src={s.best.thumb} alt="" loading="lazy" className="size-5 rounded object-cover" /> : <Ic name="search" size={12} />}
      label={<><Lit text={s.title} terms={terms} />{s.video && <i className="ml-1.5 text-[11px] not-italic text-base-content/60">video</i>}</>}
      count={<span className="flex items-center gap-1.5">
        {own
          ? <span title="In your library: plays your copy" className="flex items-center gap-0.5 text-success"><Ic name="check" size={11} width={3} />yours</span>
          : <span title={`Plays from ${sourceLabel(s.best.source)}${also.length ? `, also on ${also.join(', ')}` : ''}`}
              className="rounded bg-primary/15 px-1 text-[9.5px] font-semibold text-primary">{SHORT[s.best.source] ?? s.best.source}</span>}
        {dur && <span className="w-8 text-right">{dur}</span>}
      </span>}
      onClick={() => own ? h.onTrack(own, [own]) : void playPayload([hitPayload(s.best)])}
      onAdd={() => h.onAdd([t], s.title)}
      addTo={h.addTo}
      drag={dragProps(t)}
    />
  )
}

/** An online result: click plays it, + queues it, drag carries it like a library track. */
function OnlineRow({ hit, h }: { hit: OnlineHit; h: TreeHandlers }) {
  const t = trackOfHit(hit)
  return (
    <Row
      depth={1}
      icon={hit.thumb ? <img src={hit.thumb} alt="" loading="lazy" className="size-5 rounded object-cover" /> : <Ic name="search" size={12} />}
      label={<>{hit.title}<i className="ml-1.5 text-[11px] not-italic text-base-content/60">{[hit.artist, hit.duration ? fmtTime(hit.duration) : '', hit.kind === 'video' ? 'video' : ''].filter(Boolean).join(' · ')}</i></>}
      onClick={() => void playPayload([hitPayload(hit)])}
      onAdd={() => h.onAdd([t], hit.title)}
      addTo={h.addTo}
      drag={dragProps(t)}
    />
  )
}
