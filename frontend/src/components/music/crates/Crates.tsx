import { useState } from 'react'
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
/** Play a library as a flow (SPEC-flows-tab §2): "▶ Flow" on hover, a ⋯ menu where there is no hover. */
function FlowDoor({ crate, onFlow }: { crate: Crate; onFlow: (c: Crate, at: DOMRect) => void }) {
  const [menu, setMenu] = useState(false)
  const go = (el: HTMLElement) => { setMenu(false); onFlow(crate, el.closest('li')!.getBoundingClientRect()) }
  return (
    <>
      <button data-flow-toggle onClick={e => go(e.currentTarget)} aria-label={`Play ${crate.label} as a flow`}
        className="absolute right-2 top-1/2 hidden h-7 -translate-y-1/2 items-center gap-1 rounded-lg bg-base-300 px-2 text-xs opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:flex">
        <svg className="size-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>Flow
      </button>
      <span className="absolute right-1 top-1/2 -translate-y-1/2 [@media(hover:hover)]:hidden">
        <button onClick={() => setMenu(m => !m)} aria-label={`Options for ${crate.label}`} aria-expanded={menu} className="btn btn-ghost btn-circle btn-sm text-base-content/60">
          <svg className="size-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
        </button>
        {menu && (
          <ul className="menu menu-sm absolute right-0 top-full z-30 w-48 rounded-xl bg-base-200 p-1 shadow-lg">
            <li><button data-flow-toggle onClick={e => go(e.currentTarget)}>Play as a flow…</button></li>
          </ul>
        )}
      </span>
    </>
  )
}

export default function Crates({ crates, active, onPick, onAdd, node, onNode, onNew, onFlow }: {
  crates: Crate[]
  active: string
  onPick: (id: string) => void
  onAdd: () => void
  /** The selected playlist or smart list, '' when a library is. */
  node: string
  onNode: (id: string) => void
  /** Open the New playlist page. */
  onNew: () => void
  /** Play a library as a flow, its row's box to pin the panel under. */
  onFlow?: (c: Crate, at: DOMRect) => void
}) {
  return (
    <nav aria-label="Libraries">
      <h3 className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-base-content/50">LIBRARIES</h3>
      <ul className="flex flex-col gap-0.5">
        {crates.map(c => (
          <li key={c.id} className="group relative">
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
              <span className={`text-xs tabular-nums text-base-content/50 ${onFlow && c.id ? '[@media(hover:none)]:mr-8' : ''}`}>{c.count}</span>
            </button>
            {onFlow && c.id && <FlowDoor crate={c} onFlow={onFlow} />}
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
