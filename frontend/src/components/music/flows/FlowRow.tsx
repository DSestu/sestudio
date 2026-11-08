import { useEffect, useId, useState } from 'react'
import {
  KINDS, deleteFlow, energyShape, eventDots, firstPath, playFlow, saveFlow, type Flow, type Slot,
} from '../../../musicFlows'
import { UNKNOWN_ARTIST, type MusicTrack } from '../../../musicLibrary'
import { scopeBody, useFlowSources } from '../../../flowSources'
import { known, lengthLabel, preview } from './flowPreview'
import { flowSentence, madeWhen } from './flowWords'

// A flow on the Flows tab (SPEC-flows-tab §2, board A): its shape, what it does in one sentence,
// what it opens with; opened in place, the first tracks of a real render.

const run = (p: Promise<unknown>) => { p.catch(() => {}) }
const blur = () => (document.activeElement as HTMLElement | null)?.blur()
const artistOf = (t?: MusicTrack) => (t?.artist && t.artist !== UNKNOWN_ARTIST ? t.artist : '')

/** The energy curve as a filled line, harmony events as dots; `now` dims what has played. */
export function Shape({ flow, w, h, now, dots = true }: { flow: Pick<Flow, 'chunks'>; w: number; h: number; now?: number; dots?: boolean }) {
  const gid = useId()
  const pts = energyShape(flow) ?? [[0, 0.5], [1, 0.5]]
  const y = (v: number) => h - 3 - v * (h - 10)
  const P = pts.map(([f, v]) => [f * w, y(v)] as const)
  let d = `M${P[0][0]} ${P[0][1]}`
  for (let i = 1; i < P.length; i++) {
    const [a, b] = P[i - 1], [c, e] = P[i], m = (c - a) / 2
    d += ` C${a + m} ${b} ${c - m} ${e} ${c} ${e}`
  }
  const at = (x: number) => {
    const i = pts.findIndex(p => p[0] >= x)
    if (i <= 0) return y(pts[Math.max(0, i)][1])
    const [x0, v0] = pts[i - 1], [x1, v1] = pts[i]
    return y(v0 + ((v1 - v0) * (x - x0)) / (x1 - x0 || 1))
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block shrink-0" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--fl-energy, oklch(82% 0.11 75))" stopOpacity=".3" /><stop offset="1" stopColor="var(--fl-energy, oklch(82% 0.11 75))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${w} ${h} L0 ${h}Z`} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke="var(--fl-energy, oklch(82% 0.11 75))" strokeWidth={1.75} strokeLinecap="round" />
      {now !== undefined && <>
        <rect x={now * w} y={0} width={w - now * w} height={h} className="fill-base-100/55" />
        <line x1={now * w} x2={now * w} y1={0} y2={h} className="stroke-base-content" strokeWidth={1.5} />
        <circle cx={now * w} cy={at(now)} r={4} className="fill-base-content" />
      </>}
      {dots && eventDots(flow).map((e, i) => (
        <circle key={i} cx={Math.max(4, e.at * w)} cy={at(e.at)} r={3} strokeWidth={1.5}
          className={`stroke-base-100 ${e.kind === 'break' ? 'fill-error' : 'fill-primary'}`} />
      ))}
    </svg>
  )
}

/** "In key", "Relative", "Break"…: what a join did, toned by how far it moved. */
export function JoinTag({ join, first }: { join: string | null; first?: boolean }) {
  if (first || !join) return <span className="shrink-0 rounded-full bg-white/7 px-2 py-px text-[11px] text-base-content/60">Opens</span>
  const tone = join === 'match' ? 'bg-success/10 text-success' : join === 'break' ? 'bg-error/12 text-error' : 'bg-warning/10 text-warning'
  return <span className={`shrink-0 rounded-full px-2 py-px text-[11px] ${tone}`}>{join === 'match' ? 'In key' : KINDS[join] ?? join}</span>
}

function PlayButton({ label, onClick, small }: { label: string; onClick: () => void; small?: boolean }) {
  return (
    <button onClick={e => { e.stopPropagation(); onClick() }} aria-label={label} className={`btn btn-primary btn-circle shrink-0 ${small ? 'btn-sm' : ''}`}>
      <svg className="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>
    </button>
  )
}

function RowMenu({ flow, onOpen }: { flow: Flow; onOpen: (id: string) => void }) {
  const act = (fn: () => Promise<unknown>) => () => { blur(); run(fn()) }
  const copy = () => saveFlow(`${flow.name} copy`, { chunks: flow.chunks, pull: flow.pull, length: flow.length, allowOnline: flow.allowOnline })
  return (
    <div className="dropdown dropdown-end" onClick={e => e.stopPropagation()}>
      <button tabIndex={0} aria-label={`Options for ${flow.name}`} className="btn btn-ghost btn-circle btn-sm text-base-content/60">
        <svg className="size-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      <ul tabIndex={0} className="dropdown-content menu menu-sm z-30 w-48 rounded-xl bg-base-200 p-1 shadow-lg">
        {!flow.preset && (
          <li><button onClick={act(async () => {
            const name = window.prompt('Rename', flow.name)
            if (name?.trim()) await saveFlow(name.trim(), { chunks: flow.chunks }, flow.id)
          })}>Rename</button></li>
        )}
        <li><button onClick={act(async () => onOpen((await copy()).id))}>{flow.preset ? 'Copy and edit' : 'Copy'}</button></li>
        {!flow.preset && (
          <li><button className="text-error" onClick={act(async () => {
            if (window.confirm(`Delete ${flow.name}?`)) await deleteFlow(flow.id)
          })}>Delete</button></li>
        )}
      </ul>
    </div>
  )
}

/** Who a closed row would open with: the artists of its last render, else its genre layer. */
function opensWith(flow: Flow, byId: Map<string, MusicTrack>): string {
  const slots = known.get(flow.id)
  if (slots) {
    const artists = [...new Set(slots.map(s => artistOf(byId.get(s.track_id))).filter(Boolean))] as string[]
    if (artists.length) return artists.slice(0, 4).join(', ')
    return `Opens with ${slots.slice(0, 3).map(s => byId.get(s.track_id)?.title).filter(Boolean).join(', ')}`
  }
  return firstPath(flow).flatMap(c => c.layers.genre ?? []).flatMap(g => g.genres).slice(0, 3).join(', ')
}

export default function FlowRow({ flow, open, onToggle, onOpen, byId }: {
  flow: Flow; open: boolean; onToggle: () => void; onOpen: (id: string) => void; byId: Map<string, MusicTrack>
}) {
  const [seed, setSeed] = useState(1)
  const [tries, setTries] = useState(0)
  const sources = useFlowSources()
  const scope = scopeBody(sources)
  const key = `${flow.id}:${seed}:${tries}:${JSON.stringify(scope)}`
  const [got, setGot] = useState<{ key: string; slots?: Slot[]; failed?: boolean } | null>(null)
  useEffect(() => {
    if (!open) return
    let live = true
    preview(flow.id, seed, scope).then(slots => { if (live) setGot({ key, slots }) }, () => { if (live) setGot({ key, failed: true }) })
    return () => { live = false }
  }, [open, flow.id, seed, key]) // eslint-disable-line react-hooks/exhaustive-deps -- scope is in key
  const slots = got?.key === key ? got.slots ?? null : null
  const failed = got?.key === key && !!got.failed
  const sub = opensWith(flow, byId)
  const edit = () => flow.preset
    ? run(saveFlow(`${flow.name} copy`, { chunks: flow.chunks, pull: flow.pull, length: flow.length, allowOnline: flow.allowOnline }).then(f => onOpen(f.id)))
    : onOpen(flow.id)
  return (
    <li className={`rounded-xl ${open ? 'bg-base-200' : ''}`}>
      <div
        role="button" tabIndex={0} aria-expanded={open} onClick={onToggle}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
        className={`flex cursor-pointer items-center gap-3 rounded-xl px-1 py-2.5 sm:gap-3.5 sm:px-3 ${open ? '' : 'hover:bg-white/4'}`}
      >
        <span className="hidden sm:block"><Shape flow={flow} w={150} h={40} /></span>
        <span className="sm:hidden"><Shape flow={flow} w={70} h={34} /></span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-semibold">
            {flow.name}
            {!flow.preset && <span className="ml-2 hidden text-xs font-normal text-base-content/45 sm:inline">{madeWhen(flow.created)}</span>}
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-base-content/65">{flowSentence(flow)}</span>
          {sub && <span className="mt-0.5 hidden truncate text-xs text-base-content/45 sm:block">{sub}</span>}
        </span>
        <span className="hidden shrink-0 rounded-full bg-white/7 px-2 py-px text-[11px] text-base-content/65 sm:inline">{lengthLabel(flow)}</span>
        <PlayButton label={`Play ${flow.name}`} onClick={() => run(playFlow(flow.id, { seed, ...scope }))} small />
        <RowMenu flow={flow} onOpen={onOpen} />
      </div>
      {open && (
        <div className="px-1 pb-3 sm:pl-[176px] sm:pr-3">
          <p className="mb-1 text-xs text-base-content/45">Starts with</p>
          {failed ? (
            <p className="text-sm text-error">Could not read what it would play. <button className="link" onClick={() => setTries(n => n + 1)}>Try again</button></p>
          ) : !slots ? (
            <span className="loading loading-dots loading-sm text-base-content/40" />
          ) : !slots.length ? (
            <p className="text-sm text-base-content/55">Nothing in your library fits this flow yet.</p>
          ) : (
            <ol className="grid gap-x-6 sm:grid-cols-2">
              {slots.slice(0, 6).map((s, i) => {
                const t = byId.get(s.track_id)
                return (
                  <li key={s.track_id} className={`flex min-w-0 items-center gap-2 py-1 text-[13px] ${i >= 4 ? 'max-sm:hidden' : ''}`}>
                    <span className="min-w-0 flex-1 truncate">{t?.title ?? 'A track'}{artistOf(t) && <span className="ml-1.5 text-base-content/45">{artistOf(t)}</span>}</span>
                    <JoinTag join={s.join} first={i === 0} />
                  </li>
                )
              })}
            </ol>
          )}
          <div className="mt-2.5 flex gap-1.5">
            <button className="btn btn-sm" onClick={() => setSeed(s => s + 1)}>Another take</button>
            <button className="btn btn-sm" onClick={edit}>{flow.preset ? 'Copy and edit' : 'Edit flow'}</button>
          </div>
        </div>
      )}
    </li>
  )
}
