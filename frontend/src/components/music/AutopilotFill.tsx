import { ARCS, setAutopilot, useAutopilotState, type ArcId } from './autopilot'

/** Autopilot as the Fits next list's footer: "Keep filling like this", and the arc preset it follows. */
export default function AutopilotFill({ compact = false }: { compact?: boolean }) {
  const { on, arc } = useAutopilotState()
  const preset = ARCS.find(a => a.id === arc)!.preset
  return (
    <div className={`flex gap-2 ${compact ? "items-center" : "flex-col"}`}>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 sm:min-h-8">
        <input type="checkbox" role="switch" aria-checked={on} aria-label="Keep filling like this" className="toggle toggle-primary" checked={on} onChange={e => setAutopilot({ on: e.target.checked })} />
        <span className="min-w-0 leading-tight">
          <span className="block text-sm font-medium">Keep filling like this</span>
          {!compact && <span className="block text-xs text-base-content/60">Adds a track that fits whenever 2 are left · {preset}</span>}
        </span>
      </label>
      {on && compact && (
        <select aria-label="Autopilot arc" value={arc} onChange={e => setAutopilot({ arc: e.target.value as ArcId })} className="select select-sm w-auto bg-white/7">
          {ARCS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      )}
      {on && !compact && (
        <div role="group" aria-label="Autopilot arc" className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {ARCS.map(a => (
            <button key={a.id} aria-pressed={arc === a.id} onClick={() => setAutopilot({ arc: a.id })} className="hit h-8 shrink-0 rounded-full bg-white/7 px-3 text-xs font-semibold text-base-content/80 aria-pressed:bg-primary/22 aria-pressed:text-primary">{a.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}
