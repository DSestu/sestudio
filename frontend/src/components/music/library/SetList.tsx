import { useEffect, useMemo, useRef, useState } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import { applyOrder, joinKey, keepJoin, removeFromSet, togglePin, unkeepJoin, useSet } from '../../../musicSet'
import { fmtTime, totalTime } from '../format'
import { toast } from '../toast'
import { leanOf, type Join, type useSetOrder } from './blendOrder'
import type { Facts } from './facts'
import { Ic } from './icons'
import { clearSelection, clickSelect, idsIn, useSelection } from './selection'
import { useDeleteKey, useDragOff, useSetDrop } from './setGestures'
import { silhouette, trackColor, type Colour } from './sigil'
import { Seg } from './TapeBar'
import { MARK_COLOR } from './tapeLayout'

// Tracks in your set (SPEC-music-library §2.8): the set as a list under the lane, Rows (with a
// join line between rows), Table or Joins; the problems bar with its rail, Only problems and
// Fix all; a Fix panel under a problem join (bridges, a better spot, or keep it).

type View = 'rows' | 'table' | 'joins'
const PROBLEM: Record<string, [string, string]> = { clash: ['clash', 'clashes'], tempo: ['tempo jump', 'tempo jumps'], energy: ['energy jump', 'energy jumps'] }
const PROBLEM_TITLE: Record<string, string> = { clash: 'Clash', tempo: 'Tempo jump', energy: 'Energy jump' }

const post = async <T,>(path: string, body: unknown): Promise<T> => {
  const r = await fetch(`/api/music/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { detail?: string } | null)?.detail ?? `${path}: ${r.status}`)
  return r.json()
}
const fail = (e: Error) => toast(e.message)

export default function SetList({ order, facts, colour, byId, selectedId, onSelect, hoverProps }: {
  order: ReturnType<typeof useSetOrder>
  facts: Facts
  colour: Colour
  /** Every library track, for the bridges and the tracks Fix all inserts. */
  byId: ReadonlyMap<string, MusicTrack>
  selectedId?: string
  onSelect: (t: MusicTrack) => void
  hoverProps?: (t: MusicTrack) => object
}) {
  const s = useSet()
  const { shown, joins } = order
  const [view, setView] = useState<View>('rows')
  const [only, setOnly] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [sort, setSort] = useState<{ col: string; up: boolean } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const picked = idsIn(useSelection(), 'set')
  const shownIds = useMemo(() => shown.map(t => t.id), [shown])
  const { off, moveProps } = useDragOff(box, shown, picked, 'y')
  useDeleteKey()
  const { slot, ...dropProps } = useSetDrop(box, shown, 'y', s.mode === 'blend')

  // The problem joins that still count (kept ones do not), by their index.
  const problems = useMemo(() => (joins ?? []).map((j, i) => (s.kept.includes(joinKey(shown[i], shown[i + 1])) ? [] : j.problems)), [joins, shown, s.kept])
  const counts = useMemo(() => {
    const n: Record<string, number> = {}
    for (const p of problems) for (const k of p) n[k] = (n[k] ?? 0) + 1
    return n
  }, [problems])
  const at = (i: number): string[] => problems[i] ?? []
  const anyProblem = problems.some(p => p.length)
  useEffect(() => { if (open && !shown.some((t, i) => i < shown.length - 1 && joinKey(t, shown[i + 1]) === open)) setOpen(null) }, [open, shown]) // eslint-disable-line react-hooks/set-state-in-effect -- the open join left the set

  const fixAll = () => {
    post<{ order: string[]; inserted: string[]; moved: string[]; left: number }>('set/fix', { ids: shownIds, kept: s.kept })
      .then(r => {
        const have = new Map(shown.map(t => [t.id, t]))
        applyOrder(r.order.map(id => have.get(id) ?? byId.get(id)).filter((t): t is MusicTrack => !!t))
        const did = [r.inserted.length && `Added ${r.inserted.length} ${r.inserted.length === 1 ? 'bridge' : 'bridges'}`, r.moved.length && `moved ${r.moved.length} ${r.moved.length === 1 ? 'track' : 'tracks'}`].filter(Boolean).join(', ')
        toast(`${did || 'Nothing to change'}. ${r.left ? `${r.left} left: Keep them or fix by hand` : 'No problems left'}`)
      }, fail)
  }
  const sortBy = (col: string, key: (t: MusicTrack) => string | number) => {
    const up = sort?.col === col ? !sort.up : true
    setSort({ col, up })
    applyOrder([...shown].sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * (up ? 1 : -1) }))
  }

  if (!shown.length) return null
  const secs = shown.reduce((a, t) => a + t.duration, 0)
  const fix = (i: number) => {
    const k = joinKey(shown[i], shown[i + 1])
    return open === k ? <FixPanel key={k} a={shown[i]} b={shown[i + 1]} i={i} shown={shown} problems={at(i)} facts={facts} colour={colour} byId={byId} kept={s.kept} onClose={() => setOpen(null)} /> : null
  }
  const joinLine = (i: number) => {
    const j = joins?.[i]
    const k = joinKey(shown[i], shown[i + 1])
    return <JoinLine key={`j${k}`} j={j} problems={at(i)} kept={s.kept.includes(k)} onFix={() => setOpen(open === k ? null : k)} onUnkeep={() => unkeepJoin(k)} />
  }
  const row = (t: MusicTrack, i: number) => (
    <Row key={t.id} t={t} i={i} facts={facts} colour={colour} pinned={s.pinned.includes(t.id)} picked={picked.has(t.id)} focused={t.id === selectedId}
      drag={moveProps(t)} hover={hoverProps?.(t)} onClick={e => { clickSelect('set', t.id, shownIds, { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey }); onSelect(t) }} onPin={() => togglePin(t.id, shown)} />
  )
  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-white/4 p-3" aria-label="Tracks in your set">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Tracks in your set</h3>
        <span className="text-xs text-base-content/55">{shown.length} · {totalTime(secs)}</span>
        <span className="flex-1" />
        <Seg label="List as" options={[['rows', 'Rows'], ['table', 'Table'], ['joins', 'Joins']] as const} value={view} onPick={setView} />
      </div>
      {anyProblem && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-warning/8 px-2.5 py-1.5 text-xs">
          <span className="text-warning">{Object.entries(counts).map(([k, n]) => `${n} ${PROBLEM[k][n === 1 ? 0 : 1]}`).join(' · ')}</span>
          <span className="relative h-3 min-w-24 flex-1" aria-label="Where the problems are">
            {problems.map((p, i) => p.length ? (
              <button key={i} onClick={() => { setOpen(joinKey(shown[i], shown[i + 1])); box.current?.querySelector(`[data-join="${i}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }}
                title={`${i + 1}→${i + 2} · ${p.map(x => PROBLEM_TITLE[x]).join(', ')}`} className="absolute top-0.5 size-2 -translate-x-1/2 rotate-45 rounded-[1px]"
                style={{ left: `${((i + 1) / shown.length) * 100}%`, background: p.includes('clash') ? MARK_COLOR.rough : MARK_COLOR.close }} />
            ) : null)}
          </span>
          <label className="flex cursor-pointer items-center gap-1 text-base-content/70"><input type="checkbox" className="checkbox checkbox-xs" checked={only} onChange={e => setOnly(e.target.checked)} />Only problems</label>
          <button onClick={fixAll} className="btn btn-xs rounded-lg">Fix all</button>
        </div>
      )}
      {off !== null && <p className="text-center text-xs font-medium text-error" role="status">Release to remove {off} {off === 1 ? 'track' : 'tracks'}</p>}
      <div ref={box} {...dropProps} className="flex flex-col">
        {view === 'table' && !only ? (
          <table className="w-full text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wider text-base-content/45">
              <tr>
                {([['#', null], ['Title', (t: MusicTrack) => t.title.toLowerCase()], ['Key', (t: MusicTrack) => facts(t.id).camelot ?? ''], ['Mood', (t: MusicTrack) => -(facts(t.id).brightness ?? -9)], ['BPM', (t: MusicTrack) => facts(t.id).bpm ?? 0], ['Time', (t: MusicTrack) => t.duration], ['Next join', null]] as const).map(([col, key]) => (
                  <th key={col} className="px-1 py-1 font-medium">
                    {key ? <button onClick={() => sortBy(col, key)} className="hover:text-base-content">{col}{sort?.col === col ? (sort.up ? ' ↑' : ' ↓') : ''}</button> : col}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((t, i) => {
                const f = facts(t.id)
                const j = joins?.[i]
                return [
                  <tr key={t.id} data-set-item {...moveProps(t)} {...hoverProps?.(t)} onClick={e => { clickSelect('set', t.id, shownIds, { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey }); onSelect(t) }}
                    className={`cursor-pointer border-t border-white/6 hover:bg-white/5 ${picked.has(t.id) ? 'bg-primary/12' : ''} ${slot === i ? 'shadow-[inset_0_2px_0_var(--color-primary)]' : ''}`}>
                    <td className="px-1 py-1.5 tabular-nums text-base-content/45">{i + 1}</td>
                    <td className="max-w-48 truncate px-1">{t.title}</td>
                    <td className="px-1">{f.camelot ?? '?'}</td>
                    <td className="px-1"><i className="mr-1 inline-block size-2 rounded-full" style={{ background: f.mood?.color }} />{f.mood?.word ?? '?'}</td>
                    <td className="px-1 tabular-nums">{f.bpm ? Math.round(f.bpm) : '?'}</td>
                    <td className="px-1 tabular-nums">{fmtTime(t.duration)}</td>
                    <td className="px-1">
                      {j && i < shown.length - 1 && <span data-join={i} className="flex items-center gap-1"><Diamond j={j} />{Math.round(j.blend * 100)}{at(i).map(p => <i key={p} className="size-1.5 rounded-full bg-warning" title={PROBLEM_TITLE[p]} />)}{at(i).length > 0 && <button onClick={e => { e.stopPropagation(); setOpen(joinKey(t, shown[i + 1])) }} className="btn btn-xs h-5 min-h-0 rounded-md">Fix</button>}</span>}
                    </td>
                    <td className="px-1 text-right"><Tools t={t} pinned={s.pinned.includes(t.id)} onPin={() => togglePin(t.id, shown)} /></td>
                  </tr>,
                  i < shown.length - 1 && open === joinKey(t, shown[i + 1]) ? <tr key={`f${t.id}`}><td colSpan={8}>{fix(i)}</td></tr> : null,
                ]
              })}
            </tbody>
          </table>
        ) : view === 'joins' || only ? (
          shown.slice(0, -1).map((a, i) => {
            const b = shown[i + 1]
            if (only && !at(i).length) return null
            const j = joins?.[i]
            return (
              <div key={joinKey(a, b)} data-join={i} className="border-t border-white/6 py-1.5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="tabular-nums text-base-content/45">{i + 1}→{i + 2}</span>
                  <span className="min-w-0 truncate">{a.title} <span className="text-base-content/40">→</span> {b.title}</span>
                  <span className="flex-1" />
                  <JoinChips j={j} problems={at(i)} />
                  {at(i).length > 0 && <button onClick={() => setOpen(open === joinKey(a, b) ? null : joinKey(a, b))} className="btn btn-xs rounded-lg">Fix</button>}
                </div>
                {fix(i)}
              </div>
            )
          })
        ) : (
          shown.map((t, i) => (
            <div key={t.id} className="contents">
              {slot === i && <span className="h-0.5 rounded bg-primary" />}
              {row(t, i)}
              {i < shown.length - 1 && <div data-join={i}>{joinLine(i)}{fix(i)}</div>}
            </div>
          ))
        )}
        {slot === shown.length && <span className="h-0.5 rounded bg-primary" />}
        {only && !anyProblem && <p className="py-2 text-xs text-base-content/50">No problems left.</p>}
      </div>
    </section>
  )
}

function Diamond({ j }: { j?: Join }) {
  return <i className="inline-block size-2 shrink-0 rotate-45 rounded-[1px]" style={{ background: j ? MARK_COLOR[j.mark] : 'oklch(55% .02 240)' }} />
}

/** Score, kind, tempo, Lift / Hold / Ease, genre change. */
function JoinChips({ j, problems }: { j?: Join; problems: string[] }) {
  if (!j) return <span className="text-[11px] text-base-content/40">not read yet</span>
  const chip = (text: string, warn = false) => <span className={`rounded-md px-1.5 text-[11px] leading-5 ${warn ? 'bg-warning/15 text-warning' : 'bg-white/6 text-base-content/65'}`}>{text}</span>
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Diamond j={j} /><b className="text-[11px] font-medium tabular-nums">{Math.round(j.blend * 100)}</b>
      {j.kindLabel && chip(j.kindLabel, problems.includes('clash'))}
      {j.bpmDelta != null && chip(`${j.bpmDelta > 0 ? '+' : ''}${j.bpmDelta} bpm`, problems.includes('tempo'))}
      {chip(leanOf(j), problems.includes('energy'))}
      {j.genreChange && chip('genre change')}
    </span>
  )
}

function JoinLine({ j, problems, kept, onFix, onUnkeep }: { j?: Join; problems: string[]; kept: boolean; onFix: () => void; onUnkeep: () => void }) {
  return (
    <div className={`ml-14 flex items-center gap-2 py-0.5 ${problems.length ? 'rounded-md bg-warning/6 px-1.5' : ''}`}>
      <JoinChips j={j} problems={problems} />
      {kept && <span className="text-[11px] text-base-content/45">Kept · <button onClick={onUnkeep} className="underline">undo</button></span>}
      {problems.length > 0 && <button onClick={onFix} className="btn btn-xs h-5 min-h-0 rounded-md">Fix</button>}
    </div>
  )
}

function Tools({ t, pinned, onPin }: { t: MusicTrack; pinned: boolean; onPin: () => void }) {
  return (
    <span className="inline-flex gap-0.5">
      <button onClick={e => { e.stopPropagation(); onPin() }} aria-label={pinned ? `Unpin ${t.title}` : `Pin ${t.title}`} className={`grid size-6 place-items-center rounded-md hover:bg-white/10 ${pinned ? 'text-primary' : 'text-base-content/40'}`}><Ic name="pin" size={12} /></button>
      <button onClick={e => { e.stopPropagation(); removeFromSet([t.id]); clearSelection() }} aria-label={`Remove ${t.title}`} className="grid size-6 place-items-center rounded-md text-base-content/50 hover:bg-white/10"><Ic name="close" size={12} width={2.2} /></button>
    </span>
  )
}

function Row({ t, i, facts, colour, pinned, picked, focused, drag, hover, onClick, onPin }: {
  t: MusicTrack; i: number; facts: Facts; colour: Colour; pinned: boolean; picked: boolean; focused: boolean
  drag: object; hover?: object; onClick: (e: React.MouseEvent) => void; onPin: () => void
}) {
  const f = facts(t.id)
  const c = trackColor(f, colour)
  return (
    <div data-set-item {...drag} {...hover} onClick={onClick}
      className={`flex h-11 cursor-pointer items-center gap-2 rounded-lg px-1 hover:bg-white/5 ${picked ? 'bg-primary/12' : ''} ${focused ? 'outline-1 outline-base-content/60' : ''}`}>
      <span className="cursor-grab text-base-content/30" aria-hidden="true">⋮⋮</span>
      <span className="w-5 text-right text-[11px] tabular-nums text-base-content/45">{i + 1}</span>
      <svg width="36" height="24" viewBox="0 0 36 24" className="shrink-0" aria-hidden="true"><path d={silhouette(f.curve, 2, 32, 20, 12)} fill={c} /></svg>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[13px]">{t.title}</span>
        <span className="block truncate text-[11px] text-base-content/50">{[f.mood?.word, f.key && `${f.key}${f.camelot ? ` ${f.camelot}` : ''}`, f.bpm && Math.round(f.bpm), t.artist].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-white/8" title={`Energy ${f.energy ?? '?'}`}><span className="block h-full rounded-full" style={{ width: `${f.energy ?? 0}%`, background: c }} /></span>
      <span className="w-10 text-right text-[11px] tabular-nums text-base-content/50">{fmtTime(t.duration)}</span>
      <Tools t={t} pinned={pinned} onPin={onPin} />
    </div>
  )
}

interface Bridge { id: string; before: Join; after: Join; left: number }

/** Under a problem join: three bridges, a better spot for B, or keep it. Every fix freezes to Your order. */
function FixPanel({ a, b, i, shown, problems, facts, colour, byId, kept, onClose }: {
  a: MusicTrack; b: MusicTrack; i: number; shown: MusicTrack[]; problems: string[]; facts: Facts; colour: Colour
  byId: ReadonlyMap<string, MusicTrack>; kept: string[]; onClose: () => void
}) {
  const [bridges, setBridges] = useState<Bridge[] | null>(null)
  useEffect(() => {
    let live = true
    post<{ results: Bridge[] }>('proximity/bridges', { a: a.id, b: b.id, exclude: shown.map(t => t.id), limit: 3, strict: false })
      .then(r => { if (live) setBridges(r.results.filter(x => byId.has(x.id)).slice(0, 3)) }, e => { if (live) { setBridges([]); fail(e) } })
    return () => { live = false }
  }, [a.id, b.id]) // eslint-disable-line react-hooks/exhaustive-deps -- asked once per join
  const insert = (t: MusicTrack) => { applyOrder([...shown.slice(0, i + 1), t, ...shown.slice(i + 1)]); onClose() }
  const move = () => {
    post<{ order: string[]; left: number }>('set/spot', { ids: shown.map(t => t.id), id: b.id, kept })
      .then(r => {
        const have = new Map(shown.map(t => [t.id, t]))
        applyOrder(r.order.map(id => have.get(id)).filter((t): t is MusicTrack => !!t))
        toast(`${b.title} moved to #${r.order.indexOf(b.id) + 1} · ${r.left} ${r.left === 1 ? 'problem' : 'problems'} left`)
        onClose()
      }, fail)
  }
  const keep = () => {
    const k = joinKey(a, b)
    keepJoin(k)
    toast('Kept', () => unkeepJoin(k))
    onClose()
  }
  return (
    <div className="my-1 ml-14 flex flex-col gap-1.5 rounded-xl bg-base-200 p-2.5 text-xs">
      <p className="font-medium">{problems.map(p => PROBLEM_TITLE[p]).join(' and ')} between {a.title} and {b.title}</p>
      <p className="text-[11px] text-base-content/50">Put one of these between</p>
      {!bridges ? <p className="text-base-content/45">Looking…</p> : !bridges.length ? <p className="text-base-content/45">No track of your libraries fits between them.</p> : bridges.map(x => {
        const t = byId.get(x.id)!
        const f = facts(t.id)
        return (
          <div key={x.id} className="flex items-center gap-2">
            <svg width="36" height="24" viewBox="0 0 36 24" className="shrink-0" aria-hidden="true"><path d={silhouette(f.curve, 2, 32, 20, 12)} fill={trackColor(f, colour)} /></svg>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate">{t.title}</span>
              <span className="block truncate text-[11px] text-base-content/50">{[f.mood?.word, f.bpm && Math.round(f.bpm), x.before.shared != null && x.after.shared != null && `shares ${x.before.shared} and ${x.after.shared} notes`].filter(Boolean).join(' · ')}</span>
            </span>
            <span className={x.left ? 'text-base-content/55' : 'text-success'}>{x.left ? `softer · ${x.left} left` : 'fixes it'}</span>
            <button onClick={() => insert(t)} className="btn btn-xs rounded-lg">Insert</button>
          </div>
        )
      })}
      <div className="flex flex-wrap gap-2 pt-1">
        <button onClick={move} className="btn btn-xs rounded-lg">Move {b.title.length > 24 ? `${b.title.slice(0, 23)}…` : b.title} to a better spot</button>
        <button onClick={keep} className="btn btn-ghost btn-xs rounded-lg">Keep, I like it</button>
        <span className="flex-1" />
        <button onClick={onClose} aria-label="Close" className="btn btn-ghost btn-xs rounded-lg"><Ic name="close" size={11} /></button>
      </div>
    </div>
  )
}
