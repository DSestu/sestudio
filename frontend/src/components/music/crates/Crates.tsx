import PlaylistTree from './PlaylistTree'

export interface Crate {
  /** '' for "All". */
  id: string
  label: string
  count: number
  /** Status dot colour class; none for "All". */
  dot?: string
  /** The state line under the name: "indexing 12/40", "offline since 14:05"… */
  line?: string
}

/** The libraries and playlists column on desktop, and the body of the phone's sheet. */
export default function Crates({ crates, active, onPick, onAdd, node, onNode, onNew }: {
  crates: Crate[]
  active: string
  onPick: (id: string) => void
  onAdd: () => void
  /** The selected playlist or smart list, '' when a library is. */
  node: string
  onNode: (id: string) => void
  /** Open the New playlist page. */
  onNew: () => void
}) {
  return (
    <nav aria-label="Libraries">
      <h3 className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-base-content/50">LIBRARIES</h3>
      <ul className="flex flex-col gap-0.5">
        {crates.map(c => (
          <li key={c.id}>
            <button
              onClick={() => onPick(c.id)}
              aria-current={!node && c.id === active}
              className={`w-full flex items-center gap-2.5 rounded-xl px-3 min-h-10 py-1.5 text-sm text-left transition-colors ${
                !node && c.id === active ? 'bg-primary/20 font-semibold' : 'hover:bg-white/5 text-base-content/80'
              }`}
            >
              {c.dot && <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${c.dot}`} />}
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate">{c.label}</span>
                {c.line && <span className="block truncate text-[11px] font-normal text-base-content/50">{c.line}</span>}
              </span>
              <span className="text-xs tabular-nums text-base-content/50">{c.count}</span>
            </button>
          </li>
        ))}
        <li>
          <button onClick={onAdd} className="w-full flex items-center gap-2.5 rounded-xl px-3 h-10 text-sm text-left text-base-content/60 hover:bg-white/5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
            Add a library
          </button>
        </li>
      </ul>
      <PlaylistTree active={node} onPick={onNode} onNew={onNew} />
    </nav>
  )
}
