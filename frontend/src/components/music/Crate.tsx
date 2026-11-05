import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useDownloadedLibrary } from '../../downloadedLibrary'
import { albumsOf } from '../../musicLibrary'
import { metaLine, useSummaries, useSummary } from '../../musicMeta'
import { resolveLink, type OnlineLink, type QueueState } from '../../musicQueue'
import { hitPayload, matchWords, saveHit, useMusicSearch, type OnlineHit } from '../../musicSearch'
import { addTracks, nextIndex, type Ref } from './adding'
import { toast } from './toast'
import { fmtTime } from './format'
import Meter from './Meter'
import { armRowDrag, justDragged, type DragSource } from './rowDrag'
import { armSwipe, justSwiped } from './swipe'
import { fetchFitsAfter } from './crates/harmonyApi'
import JoinChip from './crates/JoinChip'
import type { Join } from './crates/proximity'
import { crateHeight, isPhone, isShort, shortCols } from './timeline/mapping'

// Adding to the queue (SPEC-music-player §5.5). In the default view the stage rises to uncover the crate
// under it: a shelf of cards (desktop, phone on its side) or a sheet of
// rows (phone). In the expanded view the same list is a column beside the queue
// (desktop) or the queue sheet's Library page (phone). Every row: tap adds last,
// a swipe right plays next, a hold lifts it to drop in the queue or on a join.
// A search also asks the online sources; a rail of stops (chips on phones and in
// the crate) keeps this machine's files apart from each source's streams.

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
  /** An online source's hit: artwork and a source badge, no analysis. */
  hit?: OnlineHit
  /** How it joins the last queued track, in the Fits next tab. */
  join?: Join
}

const ONLINE = ['ytmusic', 'soundcloud', 'youtube'] as const
type Source = (typeof ONLINE)[number]
type Stop = 'local' | Source
const SRC: Record<Source, { label: string; short: string; color: string }> = {
  ytmusic: { label: 'YouTube Music', short: 'YTM', color: '#ff2d55' },
  soundcloud: { label: 'SoundCloud', short: 'SC', color: '#ff6a00' },
  youtube: { label: 'YouTube', short: 'YT', color: '#e62117' },
}
const isSource = (s: string): s is Source => (ONLINE as readonly string[]).includes(s)

const onlineEntry = (h: OnlineHit): Entry => ({
  key: `${h.source}/${h.track_id}`, title: h.title, artist: h.artist, duration: h.duration, analysisId: '',
  ref: hitPayload(h), library: 'online', libraryLabel: isSource(h.source) ? SRC[h.source].label : h.source, hit: h,
})

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

/** The library ranked after the queue's last track (the server's fits-after), each with its join. */
function useFits(on: boolean, all: Entry[], queue: QueueState): Entry[] {
  const last = queue.items.at(-1)?.track_id
  const key = queue.items.map(i => i.track_id).join()
  const [res, setRes] = useState<{ key: string; list: { id: string; join: Join }[] }>()
  useEffect(() => {
    if (!on || !last) return
    let live = true
    fetchFitsAfter(last, { exclude: key.split(','), limit: 50 }).then(r => live && setRes({ key, list: r.results }), () => live && setRes({ key, list: [] }))
    return () => { live = false }
  }, [on, last, key])
  return useMemo(() => {
    const by = new Map(all.map(e => [e.analysisId, e]))
    return (res?.key === key ? res.list : []).flatMap(r => by.has(r.id) ? [{ ...by.get(r.id)!, join: r.join }] : [])
  }, [res, key, all])
}

/** The list's state: which library, the search (here and online), the stop shown, and whether a pasted link is shown instead. */
function useFinder(all: Entry[], queue: QueueState) {
  const [tab, setTab] = useState<'lib' | 'fits'>('lib')
  const fits = useFits(tab === 'fits', all, queue)
  const [query, setQuery] = useState('')
  const [lib, setLib] = useState('')
  const [paste, setPaste] = useState(false)
  const [pick, setPick] = useState<Stop | null>(null)
  const libs = useMemo(() => [...new Map(all.map(e => [e.library, e.libraryLabel])).entries()], [all])
  const ids = useMemo(() => all.map(e => e.analysisId).filter(Boolean), [all])
  const { get, v } = useSummaries(ids)
  const found = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return all.filter(e => (!lib || e.library === lib) && matchWords(words, `${e.title} ${e.artist}`.toLowerCase(), get(e.analysisId)))
  }, [all, query, lib, v]) // eslint-disable-line react-hooks/exhaustive-deps
  const q = query.trim()
  const search = useMusicSearch(q, 'all')
  const online = useMemo(() => {
    const by: Partial<Record<Source, Entry[]>> = {}
    const seen = new Set<string>()
    for (const h of search?.res.online ?? []) {
      // Albums and playlists are not one track to queue.
      if ((h.kind !== 'track' && h.kind !== 'video') || !isSource(h.source) || seen.has(h.track_id)) continue
      seen.add(h.track_id)
      ;(by[h.source] ??= []).push(onlineEntry(h))
    }
    return by
  }, [search])
  const pending: string[] = q ? (search?.pending ?? [...ONLINE]) : []
  const errors = search?.res.errors ?? {}
  // Your files first; when they have nothing, the first source that does.
  const auto: Stop = !q || found.length ? 'local' : (ONLINE.find(s => online[s]?.length) ?? 'local')
  const stop: Stop = q ? (pick ?? auto) : 'local'
  const setQ = (v: string) => { setQuery(v); if (!v.trim()) setPick(null) }
  return {
    query, setQuery: setQ, q, lib, setLib, libs, found, paste, setPaste, online, pending, errors, stop, setStop: setPick,
    tab, setTab: (t: 'lib' | 'fits') => { setPaste(false); setTab(t) },
    shown: tab === 'fits' ? fits : stop === 'local' ? found : (online[stop] ?? []),
    total: lib ? all.filter(e => e.library === lib).length : all.length,
  }
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
const saveIcon = <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
const cloudIcon = <svg aria-label="Streams" className="size-3.5 shrink-0 text-base-content/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.6 4.2 4.2 0 0 0 7 18z" /></svg>

const save = (h: OnlineHit) => {
  saveHit(h).then(() => toast(`Saving ${h.title} to the library`), () => toast(`Could not save ${h.title}`))
}

/** An online hit's artwork with its source's badge in the corner. */
function Thumb({ h, size = 36 }: { h: OnlineHit; size?: number }) {
  const src = isSource(h.source) ? SRC[h.source] : undefined
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      {h.thumb
        ? <img src={h.thumb} alt="" loading="lazy" className="size-full rounded-lg object-cover" />
        : <span className="block size-full rounded-lg bg-white/8" />}
      {src && <i className="absolute -bottom-1 -right-1 rounded px-[3px] py-px text-[8.5px] font-extrabold not-italic leading-none text-white ring-2 ring-base-200" style={{ background: src.color }}>{src.short}</i>}
    </span>
  )
}

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
      {e.hit && (
        <button aria-label={`Save ${e.title} to the library`} title="Save to the library" className={`${cls} bg-white/8 hover:bg-white/14`} style={{ width: size, height: size }} onClick={ev => { ev.stopPropagation(); save(e.hit!) }}>
          {saveIcon}
        </button>
      )}
    </span>
  )
}

const inQueue = <span title="In queue" className="relative shrink-0 text-[11px] font-semibold text-primary">✓<span className="hidden @sm:inline"> In queue</span></span>

function AddRow({ e, q, queued, aim }: { e: Entry; q: QueueState; queued: boolean; aim: Aim }) {
  const meta = useSummary(e.hit ? undefined : e.analysisId)
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
        {e.hit && <Thumb h={e.hit} />}
        <div className="flex-1 min-w-0">
          <b className="block truncate font-medium">{e.title}</b>
          <span className="block truncate text-[11px] text-base-content/52">
            {e.artist}
            {e.hit?.kind === 'video' && <em className="not-italic ml-[7px] opacity-55">video</em>}
            {metaLine(meta, bpm) && <em className="not-italic ml-[7px] opacity-55 tabular-nums">{metaLine(meta, bpm)}</em>}
          </span>
          {e.join && <JoinChip join={e.join} className="max-w-full text-[11px] text-base-content/70" />}
        </div>
        {meta?.balance && <Meter balance={meta.balance} />}
        {e.hit && cloudIcon}
        <span className="w-[30px] text-right text-[11px] text-base-content/42 tabular-nums">{e.duration ? fmtTime(e.duration) : ''}</span>
        {queued && inQueue}
        <HoverActions e={e} aim={aim} size={40} bg="color-mix(in oklab, var(--rowbg), white 5%)" className="pl-[34px] pr-3" />
      </div>
    </div>
  )
}

function AddCard({ e, q, queued, aim }: { e: Entry; q: QueueState; queued: boolean; aim: Aim }) {
  const meta = useSummary(e.hit ? undefined : e.analysisId)
  const bpm = e.bpm ?? meta?.bpm
  const tap = () => { if (!justDragged()) put(e, 'last', aim) }
  return (
    <div
      data-row
      role="button"
      tabIndex={0}
      aria-label={`Add ${e.title} to the queue`}
      className={`group relative flex h-full max-h-16 shrink-0 select-none cursor-pointer items-center gap-2.5 rounded-xl border px-3 text-[12.5px] hover:border-primary/60 outline-none focus-visible:ring-2 focus-visible:ring-primary ${e.hit ? 'w-52 border-[rgb(120_170_255/.18)] bg-[hsl(215_40%_17%)]' : 'w-44 border-white/8 bg-[hsl(205_45%_15%)]'}`}
      onClick={tap}
      onKeyDown={ev => { if (ev.key === 'Enter') tap() }}
      onPointerDown={ev => armRowDrag(ev, dragOf(q, e))}
    >
      {e.hit && <Thumb h={e.hit} size={34} />}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <b className="block truncate pr-1 font-semibold">{e.title}</b>
        {e.join && <JoinChip join={e.join} className="max-w-full text-[11px] text-base-content/70" />}
        <span className="flex items-center gap-1.5 text-[11px] text-base-content/52">
          <span className="truncate tabular-nums">{[e.hit && e.artist, bpm && `${Math.round(bpm)} BPM`, e.duration && fmtTime(e.duration)].filter(Boolean).join(' · ')}</span>
          {meta?.balance && <Meter balance={meta.balance} />}
          {queued && <span className="ml-auto text-primary font-semibold">✓</span>}
        </span>
      </div>
      <HoverActions e={e} aim={aim} size={32} bg={e.hit ? 'hsl(215 40% 17%)' : 'hsl(205 45% 15%)'} className="rounded-r-xl pl-[26px] pr-2" />
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
  // The picker filters this machine's files; an online stop just names its source.
  if (f.tab === 'fits') return null
  if (f.stop !== 'local') return <span className="truncate text-xs font-semibold" style={{ color: SRC[f.stop].color }}>{SRC[f.stop].label}</span>
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

/** Library | Fits next: the whole library, or what fits after the queue's last track. */
function Tabs({ f }: { f: Finder }) {
  return (
    <div role="tablist" aria-label="Crate" className="flex shrink-0 rounded-lg bg-white/6 p-0.5 text-xs font-semibold">
      {([['lib', 'Library'], ['fits', 'Fits next']] as const).map(([id, label]) => (
        <button key={id} role="tab" aria-selected={f.tab === id} onClick={() => f.setTab(id)} className="h-7 rounded-md px-2.5 aria-selected:bg-primary/22 aria-selected:text-primary">{label}</button>
      ))}
    </div>
  )
}

function Search({ f, className = '' }: { f: Finder; className?: string }) {
  return (
    <input
      value={f.query}
      onChange={ev => f.setQuery(ev.target.value)}
      placeholder={`Search ${f.total} tracks and online`}
      aria-label="Search your files and online"
      className={`h-10 rounded-xl bg-white/8 px-3 text-[13px] outline-none placeholder:text-base-content/40 focus-visible:ring-2 focus-visible:ring-primary ${className}`}
    />
  )
}

function PasteToggle({ f }: { f: Finder }) {
  if (f.tab === 'fits') return null
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

/** What the list says when the stop shown has no rows. */
function emptyNote(f: Finder): string {
  if (f.tab === 'fits') return 'Nothing to rank after yet: queue a track first.'
  if (f.stop === 'local') return 'No track matches.'
  const name = SRC[f.stop].label
  if (f.pending.includes(f.stop)) return `Searching ${name}…`
  if (f.errors[f.stop]) return `${name} did not answer: ${f.errors[f.stop]}`
  return `No match on ${name}.`
}

/** The rows of the stop shown (or the pasted link's tracks). */
function Rows({ f, q, aim, queued }: { f: Finder; q: QueueState; aim: Aim; queued: Set<string> }) {
  if (f.paste) return <PasteLink q={q} queued={queued} aim={aim} cards={false} />
  return (
    <>
      {f.shown.slice(0, SHOWN).map(e => <AddRow key={e.key} e={e} q={q} queued={queued.has(e.ref.track_id)} aim={aim} />)}
      {f.shown.length > SHOWN && <p className="px-3 py-2 text-center text-[11px] text-base-content/42">Search to narrow {f.shown.length - SHOWN} more.</p>}
      {!f.shown.length && <p className="px-3 py-6 text-center text-xs text-base-content/42">{emptyNote(f)}</p>}
    </>
  )
}

/** One stop's state: a count, a spinner while it searches, a red dot when it failed, nothing before a search. */
function useStops(f: Finder) {
  return [
    { id: 'local' as Stop, label: 'This PC', short: 'PC', color: '', count: f.found.length, busy: false, error: '' },
    ...ONLINE.map(s => ({
      id: s as Stop, ...SRC[s], count: f.online[s]?.length ?? 0, busy: f.pending.includes(s), error: f.errors[s] ?? '',
    })),
  ]
}

const Spin = ({ className = '' }: { className?: string }) => (
  <i aria-label="Searching" className={`inline-block size-2.5 animate-spin rounded-full border-2 border-white/20 border-t-primary ${className}`} />
)

/** The sources, as a rail beside the list (desktop column) or a row of chips: this machine, a divider, then the online sources. */
function Stops({ f, vertical }: { f: Finder; vertical: boolean }) {
  const stops = useStops(f)
  const off = !f.q
  if (vertical) {
    return (
      <div role="tablist" aria-orientation="vertical" aria-label="Sources" className="flex w-[60px] shrink-0 flex-col items-center gap-1.5 border-r border-white/7 py-2.5">
        {stops.map((s, i) => (
          <div key={s.id} className="contents">
            {i === 1 && <><span className="my-1 h-px w-8 bg-white/14" /><span className="text-[9px] font-semibold uppercase tracking-wider text-base-content/45">online</span></>}
            <button
              role="tab"
              aria-selected={f.stop === s.id}
              aria-label={`${s.label}${s.error ? `, did not answer` : off ? '' : `, ${s.count}`}`}
              title={s.error ? `${s.label} did not answer: ${s.error}` : s.id !== 'local' && off ? `${s.label}: type to search` : s.label}
              disabled={s.id !== 'local' && off}
              onClick={() => f.setStop(s.id)}
              className={`relative grid size-11 place-items-center rounded-xl text-[11px] font-extrabold disabled:opacity-35 aria-selected:ring-2 aria-selected:ring-primary ${s.id === 'local' ? 'bg-primary/18 text-primary' : 'text-white'}`}
              style={s.color ? { background: s.color } : undefined}
            >
              {s.short}
              {!(s.id !== 'local' && off) && (
                <span className="absolute -right-1.5 -top-1.5 grid h-[17px] min-w-[17px] place-items-center rounded-full border border-white/18 bg-base-200 px-1 text-[10px] font-bold text-base-content/85">
                  {s.busy ? <Spin className="size-2" /> : s.error ? <i className="size-2 rounded-full bg-error" /> : s.count}
                </span>
              )}
            </button>
            {i === 0 && <span className="text-[9px] font-semibold uppercase tracking-wider text-base-content/45">files</span>}
          </div>
        ))}
      </div>
    )
  }
  return (
    <div role="tablist" aria-label="Sources" className="flex shrink-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
      {stops.map((s, i) => (
        <div key={s.id} className="contents">
          {i === 1 && <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-white/20" />}
          <button
            role="tab"
            aria-selected={f.stop === s.id}
            title={s.error ? `${s.label} did not answer: ${s.error}` : undefined}
            disabled={s.id !== 'local' && off}
            onClick={() => f.setStop(s.id)}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-white/7 px-3 text-xs font-semibold text-base-content/80 disabled:opacity-40 aria-selected:bg-primary/22 aria-selected:text-primary"
          >
            {s.color && <i className="size-[7px] rounded-full" style={{ background: s.color }} />}
            {s.label}
            {!(s.id !== 'local' && off) && (s.busy ? <Spin /> : s.error ? <i className="size-[7px] rounded-full bg-error" /> : <span className="opacity-70 tabular-nums">{s.count}</span>)}
          </button>
        </div>
      ))}
    </div>
  )
}

/** The library as a list: the phone's crate sheet, its Library page, and the desktop's column (`rail`). */
export function LibraryList({ q, aim, aimTitle, head, onClose, rail = false }: { q: QueueState; aim: Aim; aimTitle?: string; head?: ReactNode; onClose?: () => void; rail?: boolean }) {
  const f = useFinder(useEntries(), q)
  const queued = useMemo(() => new Set(q.items.map(i => i.track_id)), [q.items])
  const list = (
    <div data-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <Rows f={f} q={q} aim={aim} queued={queued} />
    </div>
  )
  return (
    <div className="@container relative flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pb-2 pt-1">
        {head}
        <Tabs f={f} />
        <LibraryPicker f={f} />
        <span className="ml-auto" />
        <PasteToggle f={f} />
        {onClose && closeBtn(onClose)}
      </div>
      {aim.at !== null && <div className="px-3 pb-2"><AimChip aim={aim} title={aimTitle} /></div>}
      {!f.paste && f.tab === 'lib' && <div className="px-3 pb-2"><Search f={f} className="w-full" /></div>}
      {!f.paste && !rail && f.tab === 'lib' && <div className="px-3 pb-2"><Stops f={f} vertical={false} /></div>}
      {rail && !f.paste ? <div className="flex min-h-0 flex-1 border-t border-white/7">{f.tab === 'lib' && <Stops f={f} vertical />}{list}</div> : list}
    </div>
  )
}

/** The default view's crate: a floor under the stage, which rises to uncover it (Layer); on its side the phone keeps a box over the transport. */
export default function Crate({ q, aim, aimTitle, onClose }: { q: QueueState; aim: Aim; aimTitle?: string; onClose: () => void }) {
  const { W, H } = useViewport()
  const f = useFinder(useEntries(), q)
  const queued = useMemo(() => new Set(q.items.map(i => i.track_id)), [q.items])
  const short = isShort(W, H)

  useEffect(() => {
    if (!short) return
    const el = document.querySelector<HTMLElement>('[data-addp]')
    el?.animate(
      [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }],
      { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' },
    )
  }, [short])

  const head = (
    <div className="flex items-center gap-2.5">
      <h3 className="shrink-0 text-[13px] font-semibold">Add to queue</h3>
      <Tabs f={f} />
      <LibraryPicker f={f} />
      {!f.paste && f.tab === 'lib' && <Search f={f} className="h-8 w-56 min-w-0 max-w-[30vw]" />}
      {!f.paste && f.tab === 'lib' && <div className="min-w-0"><Stops f={f} vertical={false} /></div>}
      <AimChip aim={aim} title={aimTitle} />
      <span className="ml-auto" />
      <PasteToggle f={f} />
      {closeBtn(onClose)}
    </div>
  )
  const cards = (cls: string) => (
    <div data-scroll className={`min-h-0 flex-1 gap-2.5 overflow-x-auto overflow-y-hidden overscroll-contain pb-1 ${cls}`}>
      {f.paste
        ? <PasteLink q={q} queued={queued} aim={aim} cards />
        : f.shown.slice(0, SHOWN).map(e => <AddCard key={e.key} e={e} q={q} queued={queued.has(e.ref.track_id)} aim={aim} />)}
      {!f.paste && !f.shown.length && <p className="self-center px-3 text-xs text-base-content/42">{emptyNote(f)}</p>}
    </div>
  )

  if (short) {
    // On its side the phone keeps the horizon clear for drops: the crate covers the transport row instead, while open.
    return (
      <aside data-addp aria-label="Add to queue" className="glass fixed z-80 flex flex-col gap-2 rounded-2xl px-3.5 py-2.5 text-base-content" style={{ left: 12, right: shortCols(W).q + 26, bottom: 8, height: 118 }}>
        {head}
        {cards('flex items-stretch')}
      </aside>
    )
  }

  // Under the sky (-z-30), so only the part the stage has uncovered shows; the edge's shadow falls on it.
  return (
    <aside
      data-addp
      aria-label="Add to queue"
      className="fixed inset-x-0 bottom-0 -z-40 flex flex-col border-t border-white/10 bg-[linear-gradient(hsl(205_48%_8%),hsl(205_45%_10.5%))] text-base-content shadow-[inset_0_20px_28px_-20px_rgba(0,0,0,.8)]"
      style={{ height: crateHeight(W, H), ['--rowbg' as string]: 'hsl(205 47% 9%)' }}
    >
      {isPhone(W)
        ? <div className="flex min-h-0 flex-1 flex-col pt-2"><LibraryList q={q} aim={aim} aimTitle={aimTitle} head={<h3 className="shrink-0 text-[15px] font-semibold">Add to queue</h3>} onClose={onClose} /></div>
        : <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-3.5 pt-3.5">{head}{cards(f.paste ? 'flex items-stretch' : 'grid grid-flow-col grid-rows-2 auto-cols-[11rem] [&>[data-row]]:max-h-none')}</div>}
    </aside>
  )
}
