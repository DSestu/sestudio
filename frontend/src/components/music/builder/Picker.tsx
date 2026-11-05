import { useMemo, useState, type CSSProperties } from 'react'
import { formatDuration, type MusicTrack } from '../../../musicLibrary'
import { genreShort, metaLine, type Summary } from '../../../musicMeta'
import { matchWords } from '../../../musicSearch'
import { useTheory } from '../../../musicTheory'
import { cost, join, type Join } from '../crates/proximity'
import { proxOf, type Row } from './flows'

const LIMIT = 200
type Sort = 'fit' | 'bpm' | 'az'
const SORTS: [Sort, string][] = [['fit', 'Best next'], ['bpm', 'Tempo'], ['az', 'A–Z']]

const SQUARE = {
  great: 'bg-success/25 text-success',
  good: 'bg-info/25 text-info',
  clash: 'border border-warning text-warning',
  none: 'bg-white/8 text-base-content/40',
}
const squareOf = (kind: Join['kind']) => (kind === 'same-key' || kind === 'pivot' ? SQUARE.great : kind === 'clash' ? SQUARE.clash : kind ? SQUARE.good : SQUARE.none)

const Square = ({ n, cls, title, on }: { n: number; cls: string; title?: string; on?: boolean }) => (
  <i title={title} className={`grid place-items-center size-5 rounded text-[11px] font-semibold not-italic tabular-nums ${cls} ${on ? 'outline-2 outline-offset-1 outline-current' : ''}`}>{n}</i>
)

export interface Lane {
  name: string
  /** The flow's last track (or its fork); none while it is empty. */
  tail?: Row
}

/** One numbered square per flow: how the track would follow that flow's last track. The active flow's is outlined. */
function Fits({ t, lanes, active, get }: { t: MusicTrack; lanes: Lane[]; active: number; get: (id: string) => Summary | undefined }) {
  const p = proxOf(t.id, get(t.id), t.bpm)
  return (
    <span className="flex gap-1">
      {lanes.map((l, i) => {
        const j = l.tail ? join(l.tail.prox, p) : undefined
        return <Square key={i} n={i + 1} cls={j ? squareOf(j.kind) : SQUARE.great} on={i === active} title={`${l.name}: ${j ? j.kindLabel ?? 'unknown key' : 'opens the flow'}`} />
      })}
    </span>
  )
}

/** The library to pick from, ranked for the active flow's last track. + adds to the active flow; on desktop a row drags into any flow. */
export default function Picker({ all, get, tail, flowName, flowColor, lanes, active, used, onAdd, onDragStart }: {
  all: MusicTrack[]
  get: (id: string) => Summary | undefined
  /** The active flow's last track (or its fork): what the results should follow. */
  tail?: Row
  flowName?: string
  flowColor?: string
  /** Every flow of the screen, for the fit squares, and which one is active. */
  lanes: Lane[]
  active: number
  /** Ids of the tracks already in a flow: faded, not hidden. */
  used: Set<string>
  onAdd: (t: MusicTrack) => void
  onDragStart: (t: MusicTrack) => void
}) {
  const theory = useTheory()
  const [query, setQuery] = useState('')
  const [genre, setGenre] = useState('')
  const [fitOnly, setFitOnly] = useState(false)
  const [sort, setSort] = useState<Sort>('fit')

  const words = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query])
  const matched = useMemo(
    () => all.filter(t => matchWords(words, `${t.title} ${t.artist} ${t.album}`.toLowerCase(), get(t.id))),
    [all, words, get],
  )
  const genres = useMemo(() => {
    const n = new Map<string, number>()
    for (const t of matched) {
      const g = get(t.id)?.genre
      if (g) n.set(g, (n.get(g) ?? 0) + 1)
    }
    return [...n].sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [matched, get])

  const found = useMemo(() => {
    const scored = matched
      .filter(t => !genre || get(t.id)?.genre === genre)
      .map(t => ({ t, j: tail ? join(tail.prox, proxOf(t.id, get(t.id), t.bpm)) : undefined }))
      .filter(x => !fitOnly || !x.j || x.j.kind !== 'clash')
    if (sort === 'bpm') scored.sort((a, b) => (a.t.bpm ?? 0) - (b.t.bpm ?? 0))
    else if (sort === 'az' || !tail) scored.sort((a, b) => a.t.title.localeCompare(b.t.title))
    else scored.sort((a, b) => cost(a.j!) - cost(b.j!))
    return scored
  }, [matched, genre, fitOnly, sort, tail, get])

  const chip = (on: boolean) => `shrink-0 rounded-full px-3 h-7 text-xs font-medium ${on ? 'bg-primary/20 text-primary' : 'bg-white/6 text-base-content/70 hover:bg-white/10'}`
  return (
    <div className="flex flex-col min-h-0 flex-1 gap-2">
      <div className="px-3 pt-3">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search title, artist, key, mood…"
          aria-label="Search the library"
          className="input input-bordered input-sm w-full"
        />
      </div>
      <div role="group" aria-label="Filters" className="flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none]">
        <button aria-pressed={genre === ''} onClick={() => setGenre('')} className={chip(genre === '')}>All genres</button>
        {genres.map(([g]) => <button key={g} aria-pressed={genre === g} onClick={() => setGenre(genre === g ? '' : g)} className={chip(genre === g)}>{genreShort(g)}</button>)}
        {flowName && <button aria-pressed={fitOnly} onClick={() => setFitOnly(!fitOnly)} className={chip(fitOnly)}>Fits {flowName}</button>}
      </div>
      <div role="group" aria-label="Sort" className="flex items-center gap-1.5 px-3 text-xs text-base-content/60">
        Sort
        {SORTS.map(([s, label]) => <button key={s} aria-pressed={sort === s} onClick={() => setSort(s)} className={chip(sort === s)}>{label}</button>)}
      </div>
      <p className="px-3 text-xs text-base-content/60">
        {found.length} tracks{tail && flowName && sort === 'fit' && <> · ranked for <b style={{ color: flowColor }}>{flowName}</b></>}
      </p>
      <ul className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-3">
        {found.slice(0, LIMIT).map(({ t }) => (
          <li
            key={t.id}
            draggable
            onDragStart={e => { e.dataTransfer.effectAllowed = 'copyMove'; e.dataTransfer.setData('text/plain', t.title); onDragStart(t) }}
            style={{ '--lc': flowColor } as CSSProperties}
            className={`flex items-center gap-2 rounded-xl px-2 min-h-12 py-1 hover:bg-white/5 md:cursor-grab ${used.has(t.id) ? 'opacity-45' : ''}`}
          >
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium">{t.title}</span>
              <span className="block truncate text-xs text-base-content/60">{[t.artist, metaLine(get(t.id), t.bpm, theory)].filter(Boolean).join(' · ')}</span>
            </span>
            <Fits t={t} lanes={lanes} active={active} get={get} />
            <span className="text-xs tabular-nums text-base-content/50">{formatDuration(t.duration)}</span>
            <button onClick={() => onAdd(t)} aria-label={`Add ${t.title}`} className="btn btn-ghost btn-circle btn-sm relative hit">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
            </button>
          </li>
        ))}
      </ul>
      {lanes.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-3 pb-3 text-[11px] text-base-content/55">
          <Square n={1} cls={SQUARE.great} />flows well <Square n={1} cls={SQUARE.good} />next door <Square n={1} cls={SQUARE.clash} />clash · number = flow · faded = already in a flow
        </p>
      )}
    </div>
  )
}
