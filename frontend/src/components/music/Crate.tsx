import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useDownloadedLibrary } from '../../downloadedLibrary'
import { albumsOf } from '../../musicLibrary'
import { metaLine, useSummary } from '../../musicMeta'
import { resolveLink, type OnlineLink, type QueueState } from '../../musicQueue'
import { addTracks, nextIndex, type Ref } from './adding'
import { fmtTime } from './format'
import Meter from './Meter'
import { armRowDrag, justDragged, type DragSource } from './rowDrag'
import { armSwipe, justSwiped } from './swipe'
import { isPhone, isShort, shortCols } from './timeline/mapping'

// Adding to the queue (SPEC-music-player §5.5). In the default view the crate rises
// under the timeline: a shelf of cards (desktop, phone on its side) or a sheet of
// rows (phone). In the expanded view the same list is a column beside the queue
// (desktop) or the queue sheet's Library page (phone). Every row: tap adds last,
// a swipe right plays next, a hold lifts it to drop in the queue or on a join.

interface Entry {
  key: string
  title: string
  artist: string
  duration: number
  bpm?: number
  /** Where the analysis is keyed, for the balance meter. */
  analysisId: string
  ref: Ref
  library: string
  libraryLabel: string
}

/** Where an add goes: the picked join (then the one after it), else last; or next. */
export interface Aim {
  at: number | null
  set: (at: number | null) => void
}

/** Rows drawn at once: the rest is one search away. */
const SHOWN = 60

function useEntries(): Entry[] {
  const titles = useDownloadedLibrary()
  return useMemo(
    () => albumsOf(titles).flatMap(a => a.tracks).map(t => ({
      key: `${t.library}/${t.id}`, title: t.title, artist: t.artist, duration: t.duration, bpm: t.bpm, analysisId: t.id,
      ref: { library: t.library, track_id: t.id }, library: t.library, libraryLabel: t.libraryLabel,
    })),
    [titles],
  )
}

function useViewport() {
  const [, set] = useState(0)
  useEffect(() => {
    const on = () => set(n => n + 1)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return { W: innerWidth, H: innerHeight }
}

/** The list's state: which library, the search, and whether a pasted link is shown instead. */
function useFinder(all: Entry[]) {
  const [query, setQuery] = useState('')
  const [lib, setLib] = useState('')
  const [paste, setPaste] = useState(false)
  const libs = useMemo(() => [...new Map(all.map(e => [e.library, e.libraryLabel])).entries()], [all])
  const found = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return all.filter(e => (!lib || e.library === lib) && words.every(w => `${e.title} ${e.artist}`.toLowerCase().includes(w)))
  }, [all, query, lib])
  return { query, setQuery, lib, setLib, libs, found, paste, setPaste, total: lib ? all.filter(e => e.library === lib).length : all.length }
}
type Finder = ReturnType<typeof useFinder>

function put(e: Entry, where: 'last' | 'next', aim: Aim) {
  if (where === 'next') return void addTracks([e.ref], nextIndex(), `${e.title} plays next`)
  const at = aim.at
  if (at !== null) aim.set(at + 1)
  void addTracks([e.ref], at ?? undefined, `Added ${e.title}`)
}

const dragOf = (q: QueueState, e: Entry): DragSource => ({
  from: null,
  cur: () => q.current,
  onDrop: at => void addTracks([e.ref], at, at === q.current + 1 ? `${e.title} plays next` : `Added ${e.title}`),
})

const nextIcon = <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h14M12 20V9M7 13l5-5 5 5" /></svg>
const plusIcon = <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>

/** Next and last, for a pointer that hovers (touch has the swipe and the tap): a drawer
 *  that opens over the row's right end, `bg` being the hovered row's colour it fades from. */
function HoverActions({ e, aim, size, bg, className }: { e: Entry; aim: Aim; size: number; bg: string; className: string }) {
  const cls = 'grid place-items-center rounded-[10px] shrink-0'
  return (
    <span data-drawer className={`absolute inset-y-0 right-0 flex items-center gap-1 [@media(hover:none)]:hidden ${className}`} style={{ background: `linear-gradient(to right, transparent, ${bg} 28px)` }}>
      <button aria-label={`Play ${e.title} next`} title="Play next" className={`${cls} bg-white/8 hover:bg-white/14`} style={{ width: size, height: size }} onClick={ev => { ev.stopPropagation(); put(e, 'next', aim) }}>
        {nextIcon}
      </button>
      <button aria-label={`Add ${e.title} to the queue`} title="Add last" className={`${cls} bg-primary text-primary-content hover:brightness-110`} style={{ width: size, height: size }} onClick={ev => { ev.stopPropagation(); put(e, 'last', aim) }}>
        {plusIcon}
      </button>
    </span>
  )
}

const inQueue = <span title="In queue" className="relative shrink-0 text-[11px] font-semibold text-primary">✓<span className="hidden @sm:inline"> In queue</span></span>

function AddRow({ e, q, queued, aim }: { e: Entry; q: QueueState; queued: boolean; aim: Aim }) {
  const meta = useSummary(e.analysisId)
  const bpm = e.bpm ?? meta?.bpm
  const tap = () => { if (!justDragged() && !justSwiped()) put(e, 'last', aim) }
  return (
    <div
      data-row
      role="button"
      tabIndex={0}
      aria-label={`Add ${e.title} to the queue`}
      className="group relative overflow-hidden select-none touch-pan-y cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      onClick={tap}
      onKeyDown={ev => { if (ev.key === 'Enter') tap() }}
      onPointerDown={ev => {
        armRowDrag(ev, dragOf(q, e))
        armSwipe(ev, { right: { label: 'Play next', tone: 'primary', act: () => put(e, 'next', aim) } })
      }}
    >
      <div data-fg className="relative flex min-h-14 items-center gap-2.5 px-3 py-1.5 text-[13px] group-hover:bg-white/5" style={{ background: 'var(--rowbg)' }}>
        <div className="flex-1 min-w-0">
          <b className="block truncate font-medium">{e.title}</b>
          <span className="block truncate text-[11px] text-base-content/52">
            {e.artist}
            {metaLine(meta, bpm) && <em className="not-italic ml-[7px] opacity-55 tabular-nums">{metaLine(meta, bpm)}</em>}
          </span>
        </div>
        {meta?.balance && <Meter balance={meta.balance} />}
        <span className="w-[30px] text-right text-[11px] text-base-content/42 tabular-nums">{e.duration ? fmtTime(e.duration) : ''}</span>
        {queued && inQueue}
        <HoverActions e={e} aim={aim} size={40} bg="color-mix(in oklab, var(--rowbg), white 5%)" className="pl-[34px] pr-3" />
      </div>
    </div>
  )
}

function AddCard({ e, q, queued, aim }: { e: Entry; q: QueueState; queued: boolean; aim: Aim }) {
  const meta = useSummary(e.analysisId)
  const bpm = e.bpm ?? meta?.bpm
  const tap = () => { if (!justDragged()) put(e, 'last', aim) }
  return (
    <div
      data-row
      role="button"
      tabIndex={0}
      aria-label={`Add ${e.title} to the queue`}
      className="group relative flex h-full max-h-16 w-44 shrink-0 select-none cursor-pointer flex-col justify-center gap-0.5 rounded-xl border border-white/8 bg-[hsl(205_45%_15%)] px-3 text-[12.5px] hover:border-primary/60 outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onClick={tap}
      onKeyDown={ev => { if (ev.key === 'Enter') tap() }}
      onPointerDown={ev => armRowDrag(ev, dragOf(q, e))}
    >
      <b className="block truncate pr-1 font-semibold">{e.title}</b>
      <span className="flex items-center gap-1.5 text-[11px] text-base-content/52">
        <span className="tabular-nums">{[bpm && `${Math.round(bpm)} BPM`, e.duration && fmtTime(e.duration)].filter(Boolean).join(' · ')}</span>
        {meta?.balance && <Meter balance={meta.balance} />}
        {queued && <span className="ml-auto text-primary font-semibold">✓</span>}
      </span>
      <HoverActions e={e} aim={aim} size={32} bg="hsl(205 45% 15%)" className="rounded-r-xl pl-[26px] pr-2" />
    </div>
  )
}

function PasteLink({ q, queued, aim, cards }: { q: QueueState; queued: Set<string>; aim: Aim; cards: boolean }) {
  const [url, setUrl] = useState('')
  const [state, setState] = useState<{ busy: boolean; error?: string; link?: OnlineLink }>({ busy: false })
  const find = (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!url.trim()) return
    setState({ busy: true })
    resolveLink(url.trim())
      .then(link => setState({ busy: false, link }))
      .catch((err: Error) => setState({ busy: false, error: err.message }))
  }
  const entries: Entry[] = (state.link?.tracks ?? []).map(t => ({
    key: t.track_id, title: t.title ?? '', artist: t.artist ?? '', duration: t.duration ?? 0, analysisId: t.track_id, ref: t,
    library: 'online', libraryLabel: 'Online',
  }))
  const Item = cards ? AddCard : AddRow
  return (
    <>
      <form className={`flex gap-2 ${cards ? 'shrink-0 w-80' : 'px-3 pb-2'}`} onSubmit={find}>
        <input
          autoFocus
          value={url}
          onChange={ev => setUrl(ev.target.value)}
          placeholder="YouTube or YouTube Music link"
          aria-label="Link"
          className="h-10 min-w-0 flex-1 rounded-xl bg-white/8 px-3 text-[13px] outline-none placeholder:text-base-content/40 focus-visible:ring-2 focus-visible:ring-primary"
        />
        <button disabled={state.busy || !url.trim()} className="h-10 rounded-xl bg-primary/20 px-3 text-xs font-semibold text-primary disabled:opacity-40">
          {state.busy ? 'Looking…' : 'Find'}
        </button>
      </form>
      {state.error && <p role="alert" className={`text-xs text-error ${cards ? 'self-center' : 'px-3 pb-2'}`}>{state.error}</p>}
      {state.link && entries.length > 1 && (
        <button
          className={`shrink-0 text-xs font-semibold text-primary ${cards ? 'self-center px-2' : 'mx-3 mb-1 h-9 text-left'}`}
          onClick={() => void addTracks(state.link!.tracks, aim.at ?? undefined, `Added ${entries.length} tracks`)}
        >
          Add all {entries.length}
        </button>
      )}
      {entries.map(e => <Item key={e.key} e={e} q={q} queued={queued.has(e.ref.track_id)} aim={aim} />)}
    </>
  )
}

function LibraryPicker({ f }: { f: Finder }) {
  if (f.libs.length < 2) return <span className="truncate text-xs text-base-content/52">{f.libs[0]?.[1] ?? ''}</span>
  return (
    <select
      aria-label="Library"
      value={f.lib}
      onChange={e => f.setLib(e.target.value)}
      className="h-8 min-w-0 max-w-44 truncate rounded-lg bg-transparent px-1 text-xs font-semibold text-primary outline-none hover:bg-white/6 focus-visible:ring-2 focus-visible:ring-primary"
    >
      <option value="">All libraries</option>
      {f.libs.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
    </select>
  )
}

function Search({ f, className = '' }: { f: Finder; className?: string }) {
  return (
    <input
      value={f.query}
      onChange={ev => f.setQuery(ev.target.value)}
      placeholder={`Search ${f.total} tracks`}
      aria-label="Search the library"
      className={`h-10 rounded-xl bg-white/8 px-3 text-[13px] outline-none placeholder:text-base-content/40 focus-visible:ring-2 focus-visible:ring-primary ${className}`}
    />
  )
}

function PasteToggle({ f }: { f: Finder }) {
  return (
    <button
      aria-pressed={f.paste}
      className={`h-8 shrink-0 rounded-lg px-2.5 text-xs font-semibold ${f.paste ? 'bg-primary/20 text-primary' : 'bg-white/7 hover:bg-white/12'}`}
      onClick={() => f.setPaste(!f.paste)}
    >
      Paste a link
    </button>
  )
}

const closeBtn = (onClose: () => void) => (
  <button aria-label="Close" className="grid size-10 shrink-0 place-items-center rounded-xl text-lg hover:bg-white/8" onClick={onClose}>×</button>
)

function AimChip({ aim, title }: { aim: Aim; title?: string }) {
  if (aim.at === null) return null
  return (
    <span className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-primary/20 pl-3 text-xs font-semibold text-primary">
      <span className="truncate max-w-48">{title ? `Adding after ${title}` : 'Adding here'}</span>
      <button aria-label="Add last instead" className="grid size-8 place-items-center rounded-full hover:bg-white/10" onClick={() => aim.set(null)}>×</button>
    </span>
  )
}

/** The rows, under a search (or the pasted link's tracks). */
function Rows({ f, q, aim, queued }: { f: Finder; q: QueueState; aim: Aim; queued: Set<string> }) {
  if (f.paste) return <PasteLink q={q} queued={queued} aim={aim} cards={false} />
  return (
    <>
      {f.found.slice(0, SHOWN).map(e => <AddRow key={e.key} e={e} q={q} queued={queued.has(e.ref.track_id)} aim={aim} />)}
      {f.found.length > SHOWN && <p className="px-3 py-2 text-center text-[11px] text-base-content/42">Search to narrow {f.found.length - SHOWN} more.</p>}
      {!f.found.length && <p className="px-3 py-6 text-center text-xs text-base-content/42">No track matches.</p>}
    </>
  )
}

/** The library as a list: the phone's crate sheet, its Library page, and the desktop's column. */
export function LibraryList({ q, aim, aimTitle, head, onClose }: { q: QueueState; aim: Aim; aimTitle?: string; head?: ReactNode; onClose?: () => void }) {
  const f = useFinder(useEntries())
  const queued = useMemo(() => new Set(q.items.map(i => i.track_id)), [q.items])
  return (
    <div className="@container relative flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pb-2 pt-1">
        {head}
        <LibraryPicker f={f} />
        <span className="ml-auto" />
        <PasteToggle f={f} />
        {onClose && closeBtn(onClose)}
      </div>
      {aim.at !== null && <div className="px-3 pb-2"><AimChip aim={aim} title={aimTitle} /></div>}
      {!f.paste && <div className="px-3 pb-2"><Search f={f} className="w-full" /></div>}
      <div data-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <Rows f={f} q={q} aim={aim} queued={queued} />
      </div>
    </div>
  )
}

/** The default view's crate. */
export default function Crate({ q, aim, aimTitle, onClose }: { q: QueueState; aim: Aim; aimTitle?: string; onClose: () => void }) {
  const { W, H } = useViewport()
  const f = useFinder(useEntries())
  const queued = useMemo(() => new Set(q.items.map(i => i.track_id)), [q.items])
  const short = isShort(W, H)
  const sheet = isPhone(W) && !short

  useEffect(() => {
    const el = document.querySelector<HTMLElement>('[data-addp]')
    el?.animate(
      [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }],
      { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' },
    )
  }, [])

  if (sheet) {
    return (
      <aside data-addp aria-label="Add to queue" className="glass fixed inset-x-0 bottom-0 top-[52%] z-80 flex flex-col rounded-t-[22px] text-base-content" style={{ ['--rowbg' as string]: 'hsl(205 55% 11%)' }}>
        <div className="grid h-5 shrink-0 place-items-center"><i className="h-1 w-9 rounded-full bg-white/30" /></div>
        <LibraryList q={q} aim={aim} aimTitle={aimTitle} head={<h3 className="shrink-0 text-[15px] font-semibold">Add to queue</h3>} onClose={onClose} />
      </aside>
    )
  }

  // On its side the phone keeps the horizon clear for drops: the crate covers the transport row instead, while open.
  const box = short
    ? { left: 12, right: shortCols(W).q + 26, bottom: 8, height: 118 }
    : { left: 20, right: 20, bottom: 16, height: 132 }
  return (
    <aside data-addp aria-label="Add to queue" className="glass fixed z-80 flex flex-col gap-2 rounded-2xl px-3.5 py-2.5 text-base-content" style={box}>
      <div className="flex items-center gap-2.5">
        <h3 className="shrink-0 text-[13px] font-semibold">Add to queue</h3>
        <LibraryPicker f={f} />
        {!f.paste && <Search f={f} className="h-8 w-56 min-w-0 max-w-[30vw]" />}
        <AimChip aim={aim} title={aimTitle} />
        {!short && <span className="truncate text-[11.5px] text-base-content/42 max-lg:hidden">click = last · drag onto a join or the queue</span>}
        <span className="ml-auto" />
        <PasteToggle f={f} />
        {closeBtn(onClose)}
      </div>
      <div data-scroll className="flex min-h-0 flex-1 items-stretch gap-2.5 overflow-x-auto overflow-y-hidden overscroll-contain pb-1">
        {f.paste
          ? <PasteLink q={q} queued={queued} aim={aim} cards />
          : f.found.slice(0, SHOWN).map(e => <AddCard key={e.key} e={e} q={q} queued={queued.has(e.ref.track_id)} aim={aim} />)}
        {!f.paste && !f.found.length && <p className="self-center px-3 text-xs text-base-content/42">No track matches.</p>}
      </div>
    </aside>
  )
}
