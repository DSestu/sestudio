import type { ReactNode } from 'react'
import ResponsiveModal from '../../../ResponsiveModal'
import type { MusicTrack } from '../../../../musicLibrary'
import { usePlaylists } from '../../../../musicPlaylists'
import { useFlows } from '../../builder/flows'
import ArcsWay from './ArcsWay'
import GapWay from './GapWay'
import BridgeWay from './BridgeWay'
import SeedWay from './SeedWay'
import { closeBuildSet, setWay, useBuildSet, type Way } from './store'

const icon = (d: string) => <svg className="size-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d={d} /></svg>

const WAYS: { way: Way; title: string; text: string; icon: ReactNode }[] = [
  { way: 'seed', title: 'From a track', text: 'Pick one track, a length and a shape. The set grows from it.', icon: icon('M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-2a3 3 0 11-6 0 3 3 0 016 0z') },
  { way: 'arcs', title: 'Draw the arcs', text: 'Draw energy, mood and genre over time. The set follows your lines.', icon: icon('M3 17l5-6 4 4 8-10') },
  { way: 'bridge', title: 'Bridge two tracks', text: 'Pick where you are and where you want to land. Get the smoothest path.', icon: icon('M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1') },
  { way: 'gap', title: 'Fill a gap', text: 'Pick a clashing join in your set and fill it with tracks that fit both sides.', icon: icon('M12 5v14M5 12h14') },
]


/** "Build a set": a large dialog on desktop, a full-height sheet on phones. Open it with openBuildSet(). */
export default function BuildSet({ byId }: { byId: ReadonlyMap<string, MusicTrack> }) {
  const state = useBuildSet()
  const nodes = usePlaylists()
  const flow = useFlows().flows.find(f => f.id === state?.flow)
  if (!state) return null
  const info = WAYS.find(w => w.way === state.way)
  const node = nodes.find(n => n.id === state.node)

  return (
    <ResponsiveModal onClose={closeBuildSet} boxClassName="max-w-3xl max-sm:h-full max-sm:max-h-full max-sm:rounded-none">
      <div className="mb-3 flex items-center gap-2">
        {info && <button onClick={() => setWay()} className="btn btn-ghost btn-xs">‹ Ways to build</button>}
        <h3 className="font-semibold">{info?.title ?? 'Build a set'}</h3>
        {(node || flow) && <span className="ml-auto truncate text-xs text-base-content/60">for {(node ?? flow)!.name}</span>}
      </div>
      {state.way === 'seed' && <SeedWay seed={state.seed} byId={byId} />}
      {state.way === 'arcs' && <ArcsWay byId={byId} />}
      {state.way === 'gap' && <GapWay node={node} byId={byId} />}
      {state.way === 'bridge' && <BridgeWay from={state.seed} byId={byId} />}
      {!info && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {WAYS.map(w => (
            <li key={w.way}>
              <button onClick={() => setWay(w.way)} className="flex h-full w-full flex-col items-start gap-1 rounded-xl border border-white/10 p-4 text-left hover:bg-white/5">
                {w.icon}
                <b className="text-sm">{w.title}</b>
                <span className="text-xs text-base-content/60">{w.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </ResponsiveModal>
  )
}
