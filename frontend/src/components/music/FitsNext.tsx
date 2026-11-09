import { useMemo, useState, type PointerEvent, type ReactNode } from 'react'
import { keyDisplay } from '../../harmony'
import { formatDuration, type MusicTrack } from '../../musicLibrary'
import { useAnalysing, useSummaries } from '../../musicMeta'
import { filtersOf, plainKind, proxOf, rankFits, relaxations, type FitsFilters } from '../../musicFits'
import { setFitsPref as setPref, useFitsPrefs } from '../../fitsPrefs'
import { useTheory } from '../../musicTheory'
import { useSettings } from '../../useSettings'
import { joinColor, type Join, type Reading } from './crates/proximity'
import { PairSpans } from './harmony/KeySpans'
import { gapBridges } from './gaps'
import { openHarmonyBasics } from './harmony/store'
import { openKeyCard } from './harmony/keyCardStore'
import { PULL, rankByPull } from '../../flowFits'
import { useBlendWeights } from '../../musicBlendWeights'
import { KINDS, useFlows, type Flow } from '../../musicFlows'
import { useMusicQueue } from '../../musicQueue'
import { armRowDrag, type DragSource } from './rowDrag'

// "What plays well next", the same list wherever it shows: beside a playlist, in the
// player's Add to queue, or for any track. The filters are shared too, so a choice made
// in one place holds in the others.

const SHOWN = 30

/** One song across libraries: its title and artist, ignoring case. */
const songKey = (t?: MusicTrack) => t && `${t.title}\u0000${t.artist}`.toLowerCase()

const MORE: { key: keyof FitsFilters; label: string; options: [string, string][] }[] = [
  { key: 'mood', label: 'Mood', options: [['any', 'Any'], ['up', 'Brighter'], ['same', 'Same'], ['down', 'Darker']] },
  { key: 'genre', label: 'Genre', options: [['any', 'Any'], ['same', 'Same']] },
  { key: 'tempo', label: 'Tempo', options: [['near', '±6%'], ['any', 'Any']] },
]
const ENERGY: [FitsFilters['energy'], string][] = [['any', 'Any energy'], ['lift', 'Lift'], ['hold', 'Hold'], ['ease', 'Ease off']]
const PULLS: [Flow['pull'], string][] = [['light', 'Light'], ['strong', 'Strong'], ['only', 'Only']]
const LOOK: [string, string][] = [['match', 'Match'], ...['up', 'down', 'mode+', 'mode-', 'relative', 'lift', 'lower', 'break'].map(k => [k, KINDS[k]] as [string, string])]

/** Why a row ranks where it does, in the flow's words: the join, its fit, and what tempo or energy cost. */
function FlowWhy({ join, fit, tempo, energy }: { join: string | null; fit: number; tempo: number | null; energy: number | null }) {
  const tone = join === 'break' ? 'text-error' : fit >= 0.8 ? 'text-success' : 'text-base-content/75'
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-xs">
      <span className={tone}>{join ? KINDS[join] ?? join : 'Key not known'}</span>
      <span className="text-base-content/45 tabular-nums">· fit {fit.toFixed(1)}</span>
      {tempo !== null && Math.abs(tempo) > 3 && <span className="text-base-content/50 tabular-nums">· tempo {tempo > 0 ? '+' : ''}{Math.round(tempo)}</span>}
      {energy !== null && Math.abs(energy) > 0.2 && <span className="text-base-content/50">· energy {energy > 0 ? 'up' : 'down'}</span>}
    </span>
  )
}

/** One choice of a few, as joined pills; tall enough for a thumb on phones. */
function Choice<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 rounded-full bg-white/6 p-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          onClick={() => onPick(v)}
          aria-pressed={v === value}
          className={`relative hit h-8 rounded-full px-3 text-xs font-medium ${v === value ? 'bg-primary/20 text-primary' : 'text-base-content/70 hover:text-base-content'}`}
        >{text}</button>
      ))}
    </div>
  )
}

/** Why a row fits: the kind of join in its colour (with both keys known, as the small pair of runs), the energy step and any tempo jump; notes shared at the theory level. */
function Why({ j, then, theory, pair }: { j: Join; then?: Join; theory: boolean; pair?: { a?: Reading; b?: Reading; replay?: number } }) {
  const kind = (x: Join) => theory ? (x.kindLabel ?? 'Key not known') : plainKind(x.kind)
  const tempo = j.tempoJump || then?.tempoJump
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-xs">
      {pair?.a && pair.b ? <PairSpans a={pair.a} b={pair.b} replay={pair.replay} /> : <i className="inline-block size-2 shrink-0 rounded-full" style={{ background: joinColor(j) }} aria-hidden="true" />}
      <span style={{ color: joinColor(j) }}>{kind(j)}</span>
      {theory && j.semitones !== null ? <span className="text-base-content/50">· same scale</span> : theory && j.shared != null && <span className="text-base-content/50">· {j.shared} of 7 notes</span>}
      {then
        ? <span className="text-base-content/50">· then {kind(then)}</span>
        : j.energy.step && <span className="text-base-content/50">· {j.energy.step}</span>}
      {tempo && <span className="text-base-content/50">· tempo jump</span>}
    </span>
  )
}

interface Props {
  /** The track the list ranks after. */
  anchor: MusicTrack
  /** With it, the list is what fits between `anchor` and this track. */
  then?: MusicTrack
  /** Where the anchor sits, after its title ("last in the queue"). */
  where?: string
  /** The tracks to rank. */
  library: MusicTrack[]
  /** Tracks never offered (already in the playlist or queue). */
  exclude?: readonly string[]
  /** What the + on a row does, and its name for screen readers ("Insert", "Add to queue"). */
  action: { label: string; onPick: (t: MusicTrack) => void }
  /** With it, a row can be dragged into the queue like a library row. */
  drag?: (t: MusicTrack) => DragSource
  /** Or the props of a row dragged with HTML drag and drop (the playlist editor). */
  dragRow?: (t: MusicTrack) => object
  /** Leave "between" and rank after the anchor again. */
  onAfter?: () => void
  onClose?: () => void
  footer?: ReactNode
  /** A short strip (the desktop crate): the title, filters and footer share a row and the list runs in columns. */
  dense?: boolean
}

/** The ranked list of what plays well after a track (or between two), with why each fits. */
export default function FitsNext({ anchor, then, where, library, exclude = [], action, drag, dragRow, onAfter, onClose, footer, dense }: Props) {
  const theory = useTheory()
  const deep = theory.level === 'theory'
  const [settings] = useSettings()
  const f = filtersOf(useFitsPrefs(), settings.music_harmony_rule)
  const [more, setMore] = useState(false)
  /** Row id -> times the pointer came onto it: each one replays the row's slide. */
  const [enters, setEnters] = useState<Record<string, number>>({})
  // "After" ranks by the flow model: the pull and what the playing flow looks for next.
  const flowMode = !then
  const q = useMusicQueue()
  const { flows } = useFlows()
  const playing = q.source?.flow ? flows.find(x => x.id === q.source!.flow) : undefined
  const at = q.items.findIndex(i => i.track_id === anchor.id)
  const wanted = at >= 0 ? q.items[at + 1]?.flow?.event : undefined
  const [pullPick, setPull] = useState<Flow['pull'] | null>(null)
  const [lookPick, setLook] = useState<string | null>(null)
  const pull = pullPick ?? playing?.pull ?? 'strong'
  const look = lookPick ?? (wanted && !wanted.realised ? wanted.kind : 'match')
  const { get, v } = useSummaries(useMemo(() => library.map(t => t.id), [library]))
  const analysing = useAnalysing(anchor.id)
  const byId = useMemo(() => new Map(library.map(t => [t.id, t])), [library])
  const pool = useMemo(() => library.map(t => proxOf(t, get(t.id))), [library, v]) // eslint-disable-line react-hooks/exhaustive-deps
  const a = proxOf(anchor, get(anchor.id))
  const b = then && proxOf(then, get(then.id))
  const known = !!a.harmony?.track || !!a.camelot
  const fKey = JSON.stringify(f)
  // Rankings follow Blend by and Harmony moves (blendOf reads them): a change re-ranks.
  const bw = useBlendWeights()
  const exKey = exclude.join(',')
  const rows = useMemo(() => {
    const skip = new Set([...exclude, anchor.id, then?.id ?? ''])
    // The same song in two libraries is one suggestion, and never the anchor (or a taken track) again.
    const seen = new Set([...skip].map(id => songKey(byId.get(id))))
    const once = (id: string) => { const k = songKey(byId.get(id)); if (!k || seen.has(k)) return false; seen.add(k); return true }
    if (b) return gapBridges(a, b, pool, SHOWN * 2, skip).filter(r => once(r.id)).slice(0, SHOWN).map(r => ({ id: r.id, join: r.before, then: r.after }))
    return rankFits(a, pool, f).filter(r => !skip.has(r.id) && once(r.id)).slice(0, SHOWN).map(r => ({ ...r, then: undefined }))
  }, [anchor.id, then?.id, pool, exKey, fKey, bw]) // eslint-disable-line react-hooks/exhaustive-deps
  const flowRows = useMemo(() => {
    if (!flowMode) return []
    const skip = new Set([...exclude, anchor.id])
    const seen = new Set([...skip].map(id => songKey(byId.get(id))))
    const once = (id: string) => { const k = songKey(byId.get(id)); if (!k || seen.has(k)) return false; seen.add(k); return true }
    const fitOf = (t: MusicTrack) => {
      const s = get(t.id)
      const e = s?.energyScale?.track
      return { id: t.id, bpm: s?.bpm || t.bpm, energy: e === undefined ? undefined : e / 100, reading: s?.harmony?.track }
    }
    return rankByPull(fitOf(anchor), library.map(fitOf), look, PULL[pull]).filter(r => !skip.has(r.id) && once(r.id)).slice(0, SHOWN)
  }, [flowMode, anchor.id, library, v, exKey, look, pull]) // eslint-disable-line react-hooks/exhaustive-deps
  const rowProps = (t: MusicTrack) => drag ? { 'data-row': '', onPointerDown: (e: PointerEvent) => armRowDrag(e, drag(t)) } : dragRow ? dragRow(t) : {}
  const rowCls = `flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-white/5${drag ? ' select-none touch-pan-y cursor-grab' : dragRow ? ' cursor-grab' : ''}`
  const moreOn = MORE.filter(m => f[m.key] !== filtersOf({}, settings.music_harmony_rule)[m.key]).length

  const empty = analysing && !known
    ? <>Still reading the notes of <b>{anchor.title}</b>. The list fills in when it's done.</>
    : !known
      ? <>No key is known for <b>{anchor.title}</b> yet, so nothing can be ranked after it.</>
      : b ? 'Nothing in your library fits both sides.' : 'Nothing fits with these filters.'

  const head = (
    <>
      <div className={`min-w-0 flex-1 ${dense ? 'flex items-baseline gap-2' : ''}`}>
        <h2 className="shrink-0 text-base font-semibold tracking-tight">{b ? 'Fits between' : 'Fits next'}</h2>
        <p className="truncate text-xs text-base-content/60">
          {b ? <>{anchor.title} → {then!.title}</> : <>after {anchor.title}{where && ` · ${where}`}{flowMode && playing && <> · {playing.name} looks for <b className="font-medium text-primary">{look === 'match' ? 'a match' : KINDS[look]}</b></>}</>}
        </p>
      </div>
      <button onClick={() => openHarmonyBasics()} className={`btn btn-ghost btn-sm font-normal text-base-content/60 ${dense ? 'h-8' : 'h-11 sm:h-8'}`}>How it works</button>
      {onClose && (
        <button onClick={onClose} aria-label="Close" className="btn btn-ghost btn-circle size-11 sm:size-8">
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      )}
    </>
  )
  const filters = flowMode ? (
    <div className={`flex flex-wrap items-center gap-1.5 ${dense ? '' : 'px-4 pb-2'}`}>
      <Choice label="Pull" value={pull} options={PULLS} onPick={setPull} />
      <span className="text-xs text-base-content/50">Look for</span>
      <select aria-label="Look for" value={look} onChange={e => setLook(e.target.value)} className="select select-xs w-auto">
        {LOOK.map(([k, l]) => <option key={k} value={k}>{l}{wanted && !wanted.realised && wanted.kind === k ? ' · the flow' : ''}</option>)}
      </select>
    </div>
  ) : b ? (
    onAfter && <p className="px-4 pb-2 text-xs text-base-content/60">Tracks that join both sides. <button onClick={onAfter} className="text-primary hover:underline">Rank after {anchor.title} instead</button></p>
  ) : (
    <div className={`flex flex-wrap items-center gap-1.5 ${dense ? '' : 'px-4 pb-2'}`}>
          <Choice
            label="Harmony"
            value={deep || f.harmony === 'lift' || f.harmony === 'drop' ? f.harmony : f.harmony === 'any' ? 'any' : 'fits'}
            options={deep ? [['same', 'Same notes'], ['close', 'Close'], ['lift', 'Lift'], ['drop', 'Drop'], ['any', 'Any']] : [['fits', 'Smooth only'], ['lift', 'Lift'], ['drop', 'Drop'], ['any', 'Anything']]}
            onPick={h => setPref({ harmony: h === 'fits' ? (settings.music_harmony_rule === 'any' ? 'close' : settings.music_harmony_rule ?? 'close') : h as FitsFilters['harmony'] })}
          />
          <Choice label="Energy" value={f.energy} options={ENERGY} onPick={e => setPref({ energy: e })} />
          {deep && (
            <button onClick={() => setMore(m => !m)} aria-expanded={more} className="relative hit h-8 rounded-full bg-white/6 px-3 text-xs font-medium text-base-content/70">
              More{moreOn ? ` (${moreOn})` : ''}
            </button>
          )}
          {deep && more && MORE.map(m => (
            <span key={m.key} className="inline-flex items-center gap-1.5">
              <span className="text-xs text-base-content/50">{m.label}</span>
              <Choice label={m.label} value={f[m.key]} options={m.options} onPick={x => setPref({ [m.key]: x })} />
            </span>
          ))}
        </div>
  )

  return (
    <section aria-label={b ? 'Fits between' : 'Fits next'} className="flex min-h-0 flex-1 flex-col">
      {dense ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pb-1">
          {head}
          {filters}
          {footer && <div className="ml-auto">{footer}</div>}
        </div>
      ) : (
        <>
          <header className="flex items-start gap-2 px-4 pt-4 pb-2">{head}</header>
          {filters}
        </>
      )}

      <ul className={`min-h-0 flex-1 overflow-y-auto px-2 pb-2 ${dense ? 'grid grid-cols-3 content-start gap-x-2' : ''}`}>
        {flowMode && flowRows.map(r => {
          const t = byId.get(r.id)!
          const k = keyDisplay(theory, get(r.id))
          return (
            <li key={r.id} className={rowCls} {...rowProps(t)}>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-medium">{t.title}</span>
                <span className="flex items-center gap-1.5 truncate text-xs text-base-content/60">
                  <span className="truncate">{t.artist}</span>
                  {k && <span className="shrink-0">· {k.text}</span>}
                </span>
                <span className="mt-0.5 flex"><FlowWhy {...r} /></span>
              </span>
              <button onClick={() => action.onPick(t)} aria-label={`${action.label} ${t.title}`} className="btn btn-ghost btn-circle size-11 sm:size-8 text-primary">
                <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
              </button>
            </li>
          )
        })}
        {!flowMode && rows.map(r => {
          const t = byId.get(r.id)!
          const k = keyDisplay(theory, get(r.id))
          const bpm = get(r.id)?.bpm || t.bpm
          const why = <Why j={r.join} then={r.then} theory={deep} pair={{ a: get(anchor.id)?.harmony?.track, b: get(r.id)?.harmony?.track, replay: enters[r.id] ?? 0 }} />
          return (
            <li key={r.id} className={rowCls} {...rowProps(t)} onPointerEnter={() => setEnters(e => ({ ...e, [r.id]: (e[r.id] ?? 0) + 1 }))}>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-medium">{t.title}</span>
                <span className="flex items-center gap-1.5 truncate text-xs text-base-content/60">
                  <span className="truncate">{t.artist}</span>
                  {k && <span className="inline-flex shrink-0 items-center gap-1">· {k.color && <i className="inline-block size-2 rounded-full" style={{ background: k.color }} aria-hidden="true" />}{k.text}</span>}
                  {bpm ? <span className="shrink-0 tabular-nums">· {Math.round(bpm)}</span> : null}
                </span>
                {theory.level === 'tap'
                  ? <button onClick={() => openKeyCard(t.id, t.title)} aria-label={`Key card of ${t.title}`} className="mt-0.5 flex max-w-full">{why}</button>
                  : <span className="mt-0.5 flex">{why}</span>}
              </span>
              {t.duration > 0 && <span className="shrink-0 text-xs tabular-nums text-base-content/50">{formatDuration(t.duration)}</span>}
              <button onClick={() => action.onPick(t)} aria-label={`${action.label} ${t.title}`} className="btn btn-ghost btn-circle size-11 sm:size-8 text-primary">
                <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
              </button>
            </li>
          )
        })}
        {!flowMode && !rows.length && (
          <li className="flex flex-col items-center gap-3 px-4 py-8 text-center text-sm text-base-content/60">
            <p>{empty}</p>
            {known && !b && (
              <p className="flex flex-wrap justify-center gap-1.5">
                {relaxations(f).map(x => (
                  <button key={x.key} onClick={() => setPref({ [x.key]: x.to })} className="btn btn-sm btn-ghost bg-white/6">{x.label}</button>
                ))}
              </p>
            )}
          </li>
        )}
      </ul>
      {footer && !dense && <footer className="border-t border-white/8 px-4 py-3">{footer}</footer>}
    </section>
  )
}
