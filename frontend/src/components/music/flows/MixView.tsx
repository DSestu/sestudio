import { useEffect, useState } from 'react'
import { KINDS, playMix, refreshFlows, useFlows, type Mix } from '../../../musicFlows'
import type { MusicTrack } from '../../../musicLibrary'
import { useSummaries } from '../../../musicMeta'

// A mix as a list (SPEC-music-flows §7, board 4): lineage, live or frozen, pins.
// A track placed by hand is a pin; the flow refills around it. Unpin lets the flow decide again.

const run = (p: Promise<unknown>) => { p.catch(() => {}) }

interface Slot { track_id: string; chunk?: string; join?: string | null; blend?: { blocked: boolean } | null; pinned?: boolean; frozen?: boolean }

async function call(path: string, method = 'POST', body?: unknown) {
  const res = await fetch(`/api/music/mixes/${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export default function MixView({ mixId, byId, onEditFlow }: { mixId: string; byId: Map<string, MusicTrack>; onEditFlow: (flowId: string) => void }) {
  const { flows, mixes, loaded } = useFlows()
  const mix = mixes.find(m => m.id === mixId)
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [rev, setRev] = useState(0)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const { get } = useSummaries(slots?.map(s => s.track_id) ?? [])

  // The list is what the server renders: a live mix from its flow and pins, a frozen one as it was.
  useEffect(() => {
    if (!mix) return
    let live = true
    call(`${mixId}/render`).then(r => { if (live) setSlots(r.mix) }).catch(() => {})
    return () => { live = false }
  }, [mixId, mix, rev])

  if (!loaded) return <span className="loading loading-dots loading-sm text-base-content/40" />
  if (!mix) return <p className="text-sm text-base-content/60">This mix no longer exists.</p>

  const flow = flows.find(f => f.id === mix.flow)
  const frozen = mix.frozen !== null
  const update = async (fields: Partial<Mix>) => { await call(mixId, 'PATCH', fields); await refreshFlows(); setRev(r => r + 1) }
  const act = async (path: string, body?: unknown) => { await call(`${mixId}/${path}`, 'POST', body); await refreshFlows(); setRev(r => r + 1) }
  const pinned = (i: number) => mix.pins[String(i)] !== undefined
  const togglePin = (i: number) => {
    const pins = { ...mix.pins }
    if (pinned(i)) delete pins[String(i)]
    else pins[String(i)] = slots![i].track_id
    run(update({ pins }))
  }
  /** A row dropped at *to*: it is pinned there; the flow refills the rest around it. */
  const moveTo = (from: number, to: number) => {
    if (from === to || !slots) return
    const pins: Record<string, string> = {}
    for (const [k, v] of Object.entries(mix.pins)) if (v !== slots[from].track_id) pins[k] = v
    pins[String(to)] = slots[from].track_id
    run(update({ pins }))
  }

  const lineage = !mix.flow ? 'hand list · no flow yet' : `from ${flow?.name ?? 'a deleted flow'} · ${frozen ? 'frozen' : 'live, follows the flow'}`
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="w-full text-sm text-base-content/60 sm:w-auto sm:flex-1">{lineage}{slots ? ` · ${slots.length} tracks` : ''}</p>
        {mix.flow && (
          <button onClick={() => run(act(frozen ? 'thaw' : 'freeze'))} aria-pressed={frozen} className="btn btn-sm" title={frozen ? 'Follow the flow again' : 'Keep these tracks whatever happens to the flow'}>
            {frozen ? 'Frozen · thaw' : 'Freeze'}
          </button>
        )}
        {mix.flow && <button onClick={() => onEditFlow(mix.flow!)} className="btn btn-ghost btn-sm">Edit flow</button>}
        {mix.flow && !frozen && <button onClick={() => run(update({ seed: mix.seed + 1 }))} className="btn btn-ghost btn-sm" title="A cousin of this mix: same flow and pins, another draw">Regenerate</button>}
        <button onClick={() => run(playMix(mixId))} className="btn btn-primary btn-sm">Play</button>
      </div>

      {!mix.flow && (
        <div className="flex flex-wrap items-center gap-3 rounded-box bg-base-200 p-3">
          <p className="min-w-0 flex-1 text-sm">This list has no flow yet. Read one from it: every track stays pinned, and unpinning one lets the flow choose there.</p>
          <button onClick={() => run(act('read', { name: mix.name }))} className="btn btn-sm">Read as a flow</button>
        </div>
      )}

      <ol className="flex flex-col rounded-box bg-base-200 p-1.5">
        {(slots ?? []).map((s, i) => {
          const t = byId.get(s.track_id)
          const sum = get(s.track_id)
          const pin = pinned(i)
          const blocked = !!s.blend?.blocked && !s.pinned
          return (
            <li
              key={`${s.track_id}${i}`}
              draggable={!frozen}
              onDragStart={() => setDragFrom(i)}
              onDragOver={e => { if (dragFrom !== null) e.preventDefault() }}
              onDrop={() => { if (dragFrom !== null) moveTo(dragFrom, i); setDragFrom(null) }}
              className={`flex min-h-12 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm ${pin ? 'ring-1 ring-primary/50' : ''} ${frozen ? '' : 'cursor-grab'}`}
            >
              <span className="w-5 text-right text-xs tabular-nums text-base-content/40">{i + 1}</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate font-medium">{t?.title ?? s.track_id}</span>
                <span className="block truncate text-xs text-base-content/55">
                  {[sum?.bpm && `${Math.round(sum.bpm)} BPM`, sum?.harmony?.track && `${sum.harmony.track.tonic} ${sum.harmony.track.mode}`, pin && 'you placed it'].filter(Boolean).join(' · ')}
                </span>
              </span>
              {s.join && <span className={`rounded bg-white/7 px-1.5 text-[11px] ${s.join === 'break' ? 'text-error' : 'text-base-content/75'}`}>{KINDS[s.join] ?? s.join}</span>}
              {blocked && <span className="rounded-full bg-error/15 px-1.5 text-[11px] text-error" title="Nothing left met every Must">past a Must</span>}
              {!frozen && (
                <button onClick={() => togglePin(i)} aria-pressed={pin} className={`btn btn-ghost btn-xs ${pin ? 'text-primary' : 'text-base-content/60'}`}>
                  {pin ? 'Unpin' : 'Pin'}
                </button>
              )}
            </li>
          )
        })}
        {slots && !slots.length && <li className="p-4 text-center text-xs text-base-content/50">Nothing fits this flow yet.</li>}
      </ol>
      {!frozen && <p className="text-xs text-base-content/50">Drag a row to move it: it becomes a pin there, and the flow refills around it.</p>}
    </div>
  )
}
