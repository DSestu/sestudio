import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useDownloadedLibrary } from '../../downloadedLibrary'
import { albumsOf } from '../../musicLibrary'
import { metaLine, useSummary } from '../../musicMeta'
import { post, resolveLink, type AddPayload, type OnlineLink, type QueueState } from '../../musicQueue'
import { fmtTime } from './format'
import { fitHeight } from './interact'
import Meter from './Meter'
import { armRowDrag, gripRowDrag, type DragSource } from './rowDrag'

type Ref = AddPayload['tracks'][number]
interface Entry {
  key: string
  title: string
  artist: string
  duration: number
  bpm?: number
  /** Where the analysis is keyed, for the balance meter. */
  analysisId: string
  ref: Ref
}

const TABS = [
  { id: 'server', label: 'On this server' },
  { id: 'ytm', label: 'YouTube Music' },
  { id: 'sc', label: 'SoundCloud' },
  { id: 'link', label: 'Paste a link' },
] as const
type Tab = (typeof TABS)[number]['id']

/** Rows drawn at once: the rest is one search away. */
const SHOWN = 60

const add = (refs: Ref[], index?: number) => post({ tracks: refs, ...(index !== undefined && { index }) })

function EntryRow({ e, q, queued, toast }: { e: Entry; q: QueueState; queued: boolean; toast: (m: string) => void }) {
  const meta = useSummary(e.analysisId)
  const bpm = e.bpm ?? meta?.bpm
  const source: DragSource = {
    from: null,
    cur: () => q.current,
    onDrop: at => { void add([e.ref], at); toast(`Added ${e.title}`) },
  }
  const put = (index?: number) => { void add([e.ref], index); toast(`Added ${e.title}`) }
  return (
    <div
      data-row
      className="relative flex items-center gap-2 px-3 py-[7px] text-[13px] select-none hover:bg-white/5"
      onPointerDown={ev => armRowDrag(ev, source)}
    >
      <span
        aria-label="Drag into the queue"
        data-grip
        className="flex shrink-0 px-0.5 py-1 text-base-content/30 hover:text-base-content cursor-grab touch-none"
        onPointerDown={ev => gripRowDrag(ev, source)}
      >
        <svg className="size-3.5" viewBox="0 0 14 14" fill="currentColor">
          {[3, 7, 11].map(y => [4, 10].map(x => <circle key={`${x}${y}`} cx={x} cy={y} r="1.1" />))}
        </svg>
      </span>
      <div className="flex-1 min-w-0">
        <b className="block truncate font-medium">{e.title}</b>
        <span className="block truncate text-[11px] text-base-content/52">
          {e.artist}
          {metaLine(meta, bpm) && <em className="not-italic ml-[7px] opacity-55 tabular-nums">{metaLine(meta, bpm)}</em>}
        </span>
      </div>
      {meta?.balance && <Meter balance={meta.balance} />}
      <span className="w-[30px] text-right text-[11px] text-base-content/42 tabular-nums">{e.duration ? fmtTime(e.duration) : ''}</span>
      {queued && <span className="text-[10.5px] text-base-content/42">In queue</span>}
      <button
        className="h-[22px] rounded-[7px] px-1.5 text-[11px] font-medium text-base-content/70 hover:bg-white/8 hover:text-base-content"
        onClick={() => put(q.current >= 0 ? q.current + 1 : undefined)}
      >
        Play next
      </button>
      <button
        aria-label={`Add ${e.title} to the queue`}
        className="size-[22px] rounded-[7px] grid place-items-center text-base text-primary hover:bg-primary/20"
        onClick={() => put()}
      >
        +
      </button>
    </div>
  )
}

function PasteLink({ q, queued, toast }: { q: QueueState; queued: Set<string>; toast: (m: string) => void }) {
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
  }))
  return (
    <>
      <form className="flex gap-2 px-3 pb-2" onSubmit={find}>
        <input
          value={url}
          onChange={ev => setUrl(ev.target.value)}
          placeholder="YouTube or YouTube Music link"
          aria-label="Link"
          className="h-9 min-w-0 flex-1 rounded-[10px] bg-white/8 px-3 text-[13px] outline-none placeholder:text-base-content/40 focus-visible:ring-2 focus-visible:ring-primary"
        />
        <button disabled={state.busy || !url.trim()} className="h-9 rounded-[10px] bg-primary/20 px-3 text-xs font-semibold text-primary disabled:opacity-40">
          {state.busy ? 'Looking…' : 'Find'}
        </button>
      </form>
      {state.error && <p role="alert" className="px-3 pb-2 text-xs text-error">{state.error}</p>}
      {state.link && (
        <div className="flex items-center gap-2 px-3 pb-1 text-xs text-base-content/52">
          <span className="min-w-0 flex-1 truncate">{state.link.title}</span>
          {entries.length > 1 && (
            <button
              className="shrink-0 font-semibold text-primary"
              onClick={() => { void add(state.link!.tracks); toast(`Added ${entries.length} tracks`) }}
            >
              Add all {entries.length}
            </button>
          )}
        </div>
      )}
      {entries.map(e => <EntryRow key={e.key} e={e} q={q} queued={queued.has(e.ref.track_id)} toast={toast} />)}
    </>
  )
}

/** The panel that finds tracks to queue (SPEC-music-player §5.5). Tracks on this server and pasted links work; the other sources arrive with the search PR. */
export default function AddPanel({ q, onClose }: { q: QueueState; onClose: () => void }) {
  const titles = useDownloadedLibrary()
  const [tab, setTab] = useState<Tab>('server')
  const [query, setQuery] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [height, setHeight] = useState<number>()
  const panel = useRef<HTMLElement>(null)
  const timer = useRef(0)

  const all = useMemo<Entry[]>(
    () => albumsOf(titles).flatMap(a => a.tracks).map(t => ({
      key: `${t.library}/${t.id}`, title: t.title, artist: t.artist, duration: t.duration, bpm: t.bpm, analysisId: t.id,
      ref: { library: t.library, track_id: t.id },
    })),
    [titles],
  )
  const found = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return all.filter(e => words.every(w => `${e.title} ${e.artist}`.toLowerCase().includes(w)))
  }, [all, query])
  const queued = useMemo(() => new Set(q.items.map(i => i.track_id)), [q.items])

  const toast = (m: string) => {
    setNote(m)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setNote(null), 1600)
  }

  // The height follows the content (bottom of the last child + 10), within the room there is.
  useLayoutEffect(() => {
    const fit = () => {
      const el = panel.current
      if (!el) return
      const end = [...el.children].reduce((m, c) => {
        if ((c as HTMLElement).dataset.nofit !== undefined) return m
        const h = c as HTMLElement
        return Math.max(m, h.offsetTop + (h.dataset.scroll !== undefined ? h.scrollHeight : h.offsetHeight))
      }, 0)
      const max = window.innerHeight - (window.matchMedia('(min-width: 768px)').matches ? 112 : 48)
      const next = fitHeight(end, max)
      setHeight(h => (h === next ? h : next))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  })

  useLayoutEffect(() => {
    const phone = !window.matchMedia('(min-width: 768px)').matches
    panel.current?.animate(
      [
        { opacity: 0, transform: phone ? 'translateY(24px)' : 'translateX(16px)', filter: 'blur(6px)' },
        { opacity: 1, transform: 'none', filter: 'blur(0)' },
      ],
      { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' },
    )
  }, [])

  return (
    <aside
      ref={panel}
      data-addp
      aria-label="Add music"
      style={{ height }}
      className="fixed z-80 glass flex flex-col overflow-hidden transition-[height] duration-320 ease-smooth text-base-content inset-x-0 bottom-0 rounded-t-2xl md:inset-x-auto md:bottom-auto md:left-[calc(100vw-772px)] md:top-23 md:w-95 md:rounded-2xl"
    >
      <header className="flex items-center px-3 pt-3 pb-2">
        <h3 className="flex-1 text-sm font-semibold">Add music</h3>
        <button aria-label="Close" className="size-[30px] rounded-lg grid place-items-center text-lg hover:bg-white/8" onClick={onClose}>×</button>
      </header>
      <div role="tablist" className="flex gap-1.5 overflow-x-auto px-3 pb-2">
        {TABS.map(t => {
          const real = t.id === 'server' || t.id === 'link'
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              disabled={!real}
              title={real ? undefined : 'Coming soon'}
              className={`h-[26px] shrink-0 rounded-[9px] px-2.5 text-xs font-semibold disabled:opacity-35 ${
                tab === t.id ? 'bg-primary/20 text-primary' : 'bg-white/6 text-base-content/70 hover:bg-white/10'
              }`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      {tab === 'server' ? (
        <>
          <div className="px-3 pb-2">
            <input
              value={query}
              onChange={ev => setQuery(ev.target.value)}
              placeholder={`Search ${all.length} tracks on this server`}
              aria-label="Search this server's tracks"
              className="h-9 w-full rounded-[10px] bg-white/8 px-3 text-[13px] outline-none placeholder:text-base-content/40 focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
          <p className="px-3 pb-1.5 text-[11px] text-base-content/42">
            {found.length} of {all.length} · drag a track into the queue, or use + / Play next
          </p>
          <div data-scroll className="min-h-0 overflow-y-auto overscroll-contain">
            {found.slice(0, SHOWN).map(e => <EntryRow key={e.key} e={e} q={q} queued={queued.has(e.ref.track_id)} toast={toast} />)}
            {found.length > SHOWN && <p className="px-3 py-2 text-center text-[11px] text-base-content/42">Search to narrow {found.length - SHOWN} more.</p>}
            {!found.length && <p className="px-3 py-4 text-center text-xs text-base-content/42">No track matches.</p>}
          </div>
        </>
      ) : (
        <div data-scroll className="min-h-0 overflow-y-auto overscroll-contain">
          <PasteLink q={q} queued={queued} toast={toast} />
        </div>
      )}
      {note && (
        <p data-nofit role="status" className="pointer-events-none absolute inset-x-3 bottom-3 rounded-lg bg-black/70 px-3 py-1.5 text-center text-xs font-medium">
          {note}
        </p>
      )}
    </aside>
  )
}
