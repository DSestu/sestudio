import { useEffect, useRef, useState } from 'react'
import { KINDS, forkAhead, refreshFlows, reroute, useFlows } from '../../../musicFlows'
import type { FlowSlot, QueueState } from '../../../musicQueue'

// The playing mix in the player (SPEC-music-flows §5, board 2): the path lit through the flow,
// the fork ahead as a choice, and the join each row made.

const run = (p: Promise<unknown>) => { p.catch(() => {}) }

/** One word for what a row's join did, and whether it went past a Must. */
export function SlotChip({ slot }: { slot: FlowSlot }) {
  const blocked = !!slot.blend?.blocked && !slot.pinned
  if (!slot.join && !blocked) return null
  const good = slot.fit !== null && slot.fit >= 0.8
  const tone = slot.join === 'break' ? 'text-error' : good ? 'text-success' : 'text-base-content/70'
  const served = slot.event?.realised ? ' ✓' : ''
  return (
    <span className="relative flex shrink-0 items-center gap-1 text-[11px]" title={slot.fit !== null ? `fit ${slot.fit.toFixed(1)}` : undefined}>
      {slot.join && <span className={`rounded bg-white/7 px-1.5 py-px ${tone}`}>{KINDS[slot.join] ?? slot.join}{served}</span>}
      {blocked && <span className="rounded-full bg-error/15 px-1.5 py-px text-error" title="Nothing left met every Must">past a Must</span>}
    </span>
  )
}

export default function FlowStrip({ q }: { q: QueueState }) {
  const { flows } = useFlows()
  const [saved, setSaved] = useState(false)
  const src = q.source
  const flow = src?.flow ? flows.find(f => f.id === src.flow) : undefined
  const fork = forkAhead(q, flow)
  // A fork with conditions is asked again as it comes near: skips and the clock may have changed since the mix was drawn.
  const asked = useRef('')
  const conditional = !!fork && !src?.choices[fork.chunk] && !!flow?.chunks.find(c => c.id === fork.chunk)?.when
  const key = fork ? `${fork.chunk}:${q.current}:${q.skips?.length ?? 0}` : ''
  useEffect(() => {
    if (!conditional || asked.current === key) return
    asked.current = key
    run(reroute({}))
  }, [conditional, key])
  if (!src?.flow) return null
  const cur = q.items[q.current]?.flow?.chunk
  // Untaken futures of every fork on the path, dashed beside the taken one.
  const untaken = flow
    ? src.path.flatMap(id => (flow.chunks.find(c => c.id === id)?.next ?? []).filter(n => !src.path.includes(n)))
    : []
  const pending = q.items.slice(q.current + 1).find(i => i.flow?.event && !i.flow.event.realised)?.flow?.event
  const save = async () => {
    await fetch('/api/music/mixes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${flow?.name ?? 'Mix'} · ${new Date().toLocaleDateString()}`, flow: src.flow, choices: src.choices, seed: src.seed, minutes: src.minutes }),
    })
    await refreshFlows()
    setSaved(true)
  }
  return (
    <div className="relative flex flex-col gap-1.5 px-3 pb-2">
      <div className="flex items-center gap-1" aria-label={`Playing ${flow?.name ?? 'a flow'}`}>
        {src.path.map(id => (
          <span
            key={id}
            aria-current={id === cur || undefined}
            className={`h-6 min-w-0 flex-1 truncate rounded-md px-2 text-[11px] leading-6 ${id === cur ? 'bg-primary/25 text-primary ring-1 ring-primary' : 'bg-primary/10 text-primary/80'}`}
          >
            {id}{src.auto[src.path[src.path.indexOf(id) - 1]] === id ? ' · auto' : ''}
          </span>
        ))}
        {untaken.map(id => (
          <span key={id} className="h-6 min-w-0 flex-1 truncate rounded-md px-2 text-[11px] leading-6 text-base-content/45 outline-1 outline-dashed outline-base-content/25">{id}</span>
        ))}
        <button
          onClick={() => run(save())} disabled={saved}
          className="ml-1 h-6 shrink-0 rounded-md bg-white/7 px-2 text-[11px] font-semibold hover:bg-white/12 disabled:opacity-60"
        >
          {saved ? 'Saved' : 'Save mix'}
        </button>
      </div>
      {fork && (
        <div role="group" aria-label="Fork ahead" className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-primary/70 px-2.5 py-1.5 text-[11px]">
          <b className="font-semibold">Fork in {fork.left + 1} {fork.left ? 'tracks' : 'track'}</b>
          {fork.futures.map(id => (
            <button
              key={id}
              aria-pressed={fork.taken === id}
              onClick={() => run(reroute({ choices: { [fork.chunk]: id } }))}
              className={`h-7 rounded-md px-2.5 font-semibold ${fork.taken === id ? 'bg-primary/22 text-primary' : 'bg-white/7 hover:bg-white/12'}`}
            >
              {id}
            </button>
          ))}
          <span className="text-base-content/50">{src.choices[fork.chunk] ? 'your choice' : 'the flow chose; silence keeps it'}</span>
        </div>
      )}
      {pending && <p className="text-[11px] text-primary">Looking for {KINDS[pending.kind] ?? pending.kind}</p>}
    </div>
  )
}
