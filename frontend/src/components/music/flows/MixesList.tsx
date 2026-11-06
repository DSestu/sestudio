import EmptyState from '../../EmptyState'
import { playMix, useFlows, type Flow, type Mix } from '../../../musicFlows'

// Every list is a mix (SPEC-music-flows §7): live on its flow, frozen, or a hand list with no flow yet.

const run = (p: Promise<unknown>) => { p.catch(() => {}) }

function lineage(mix: Mix, flows: Flow[]): string {
  const flow = flows.find(f => f.id === mix.flow)
  if (!mix.flow) return 'hand list · no flow yet'
  const from = `from ${flow?.name ?? 'a deleted flow'}`
  return mix.frozen ? `${from} · frozen` : `${from} · live, follows the flow`
}

export default function MixesList({ onOpen }: { onOpen: (id: string) => void }) {
  const { flows, mixes, loaded } = useFlows()
  if (loaded && !mixes.length) {
    return <EmptyState title="No mixes yet" message="Play a flow, then save what it made as a mix." />
  }
  return (
    <ul className="flex flex-col">
      {mixes.map(m => (
        <li key={m.id} className="flex h-14 items-center gap-3 rounded-xl px-3 hover:bg-white/5">
          <button onClick={() => onOpen(m.id)} className="min-w-0 flex-1 text-left leading-tight">
            <span className="block truncate text-sm font-semibold">{m.name}</span>
            <span className="block truncate text-xs text-base-content/60">
              {lineage(m, flows)}{m.frozen ? ` · ${m.frozen.length} tracks` : ''}
            </span>
          </button>
          <button onClick={() => run(playMix(m.id))} aria-label={`Play ${m.name}`} className="btn btn-ghost btn-sm btn-circle">
            <svg className="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>
          </button>
        </li>
      ))}
    </ul>
  )
}
