import type { LibraryStatus } from '../../../musicLibraries'
import { useFlows } from '../../../musicFlows'
import { applyPreset, setGrouping, toggleDim, useGrouping } from '../../../musicGrouping'
import PlaylistTree from '../crates/PlaylistTree'
import { Shape } from '../flows/FlowRow'
import { Nodes, Row, type TreeHandlers } from './ExplorerTree'
import { DIMS, GROUP_SORTS, PRESETS, TRACK_SORTS, findNode, groupingLabel, presetOf, sortLabel, type Dim, type GroupNode } from './grouping'
import { Ic, type IconName } from './icons'

// The explorer (SPEC-music-library §2.2): the icon rail, the Library tree for the grouping
// (a file explorer in Library mode), Lists, Flows and Online.

const RAIL_ICON: Record<string, IconName> = {
  album: 'album', artist: 'user', files: 'disk', mood: 'mood', genre: 'tag', tempo: 'tempo', energy: 'bars', key: 'key', az: 'az', flat: 'list',
}
const ONLINE = ['YouTube Music', 'YouTube', 'SoundCloud']

export interface ExplorerProps {
  tree: GroupNode[]
  total: number
  libraries: LibraryStatus[]
  h: TreeHandlers
  /** The open file-explorer folder, for the address bar. */
  dir?: GroupNode
  onList: (id: string) => void
  onNewList: () => void
  onFlow: (id: string) => void
  onFlows: () => void
  onMix: (id: string) => void
  onMixes: () => void
  onAddLibrary: () => void
  onClose?: () => void
  /** Search mode: the flat results replace the rail and the sections. */
  search?: { words: string; body: React.ReactNode }
}

export default function Explorer({ tree, total, libraries, h, dir, onList, onNewList, onFlow, onFlows, onMix, onMixes, onAddLibrary, onClose, search }: ExplorerProps) {
  const g = useGrouping()
  const preset = presetOf(g)
  const { flows, mixes } = useFlows()
  const blur = () => (document.activeElement as HTMLElement | null)?.blur()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <b className="text-sm">Explorer</b>
        <small className="truncate text-xs text-base-content/50">{search ? `matching “${search.words}”` : `${total} tracks`}</small>
        <span className="flex-1" />
        {onClose && <button onClick={onClose} aria-label="Close" className="btn btn-ghost btn-circle btn-xs relative hit"><Ic name="close" size={15} /></button>}
      </div>
      {search ? <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 text-sm">{search.body}</div> : <div className="flex min-h-0 flex-1">
        <nav aria-label="Group by" className="flex w-13 shrink-0 flex-col items-stretch gap-0.5 border-r border-white/8 px-1 pb-2">
          {PRESETS.map(p => (
            <button key={p.id} onClick={() => applyPreset(p.id)} aria-pressed={preset === p.id} title={p.dims.length > 1 ? `${p.label} › ${p.dims.slice(1).map(d => DIMS[d].label).join(' › ')}` : p.label}
              className={`flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[9px] leading-none ${preset === p.id ? 'bg-primary/15 text-primary' : 'text-base-content/60 hover:bg-white/5 hover:text-base-content'}`}>
              <Ic name={RAIL_ICON[p.id]} size={17} /><span>{p.label}</span>
            </button>
          ))}
          <div className="dropdown dropdown-right">
            <button tabIndex={0} aria-pressed={!preset} title={`Stack levels: ${groupingLabel(g)}`} className={`flex w-full flex-col items-center gap-0.5 rounded-lg py-1.5 text-[9px] leading-none ${!preset ? 'bg-primary/15 text-primary' : 'text-base-content/60 hover:bg-white/5 hover:text-base-content'}`}>
              <Ic name="layers" size={17} /><span>Custom</span>
            </button>
            <div tabIndex={0} className="dropdown-content z-30 ml-1 w-52 rounded-xl bg-base-200 p-2 shadow-lg">
              <p className="px-1 pb-1 text-[11px] text-base-content/50">Stack levels · click in order</p>
              {(Object.keys(DIMS) as Dim[]).map(d => {
                const i = g.files ? -1 : g.dims.indexOf(d)
                return (
                  <button key={d} onClick={() => toggleDim(d)} className={`flex w-full items-center gap-2 rounded-lg px-2 h-8 text-sm ${i >= 0 ? 'bg-primary/15 text-primary' : 'hover:bg-white/5'}`}>
                    <Ic name={RAIL_ICON[d === 'letter' ? 'az' : d === 'library' ? 'files' : d]} size={14} /><span className="flex-1 text-left">{DIMS[d].label}</span>
                    {i >= 0 && <em className="grid size-4 place-items-center rounded-full bg-primary/25 text-[10px] not-italic">{i + 1}</em>}
                  </button>
                )
              })}
              <hr className="my-1 border-white/10" />
              <button onClick={() => { setGrouping({ files: false, dims: [] }); blur() }} className="flex w-full items-center gap-2 rounded-lg px-2 h-8 text-sm hover:bg-white/5"><Ic name="list" size={14} />Flat, no levels</button>
              <p className="px-1 pt-1 text-[11px] text-base-content/50">{groupingLabel(g)}</p>
            </div>
          </div>
          <span className="flex-1" />
          <div className="dropdown dropdown-right dropdown-end">
            <button tabIndex={0} title={`Sort: ${sortLabel(g)}`} className="flex w-full flex-col items-center gap-0.5 rounded-lg py-1.5 text-[9px] leading-none text-base-content/60 hover:bg-white/5 hover:text-base-content">
              <Ic name="sort" size={17} /><span>Sort</span>
            </button>
            <div tabIndex={0} className="dropdown-content z-30 ml-1 w-48 rounded-xl bg-base-200 p-2 shadow-lg">
              <p className="px-1 pb-1 text-[11px] text-base-content/50">Groups</p>
              {GROUP_SORTS.map(([k, l]) => <button key={k} onClick={() => setGrouping({ groupSort: k })} aria-pressed={g.groupSort === k} className={`block w-full rounded-lg px-2 h-7 text-left text-sm ${g.groupSort === k ? 'bg-primary/15 text-primary' : 'hover:bg-white/5'}`}>{l}</button>)}
              <p className="px-1 pt-2 pb-1 text-[11px] text-base-content/50">Tracks</p>
              {TRACK_SORTS.map(([k, l]) => <button key={k} onClick={() => setGrouping({ trackSort: k })} aria-pressed={g.trackSort === k} className={`block w-full rounded-lg px-2 h-7 text-left text-sm ${g.trackSort === k ? 'bg-primary/15 text-primary' : 'hover:bg-white/5'}`}>{l}</button>)}
            </div>
          </div>
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto px-1.5 pb-2 text-sm">
          {g.files && <Address dir={dir} libraries={libraries} tree={tree} onOpen={h.onOpen} />}
          <Section title="Library" hint={g.files ? 'folders' : `by ${groupingLabel(g).toLowerCase()}`} action={g.files ? <button onClick={onAddLibrary} className="btn btn-ghost btn-xs">Add</button> : undefined}>
            {tree.length ? <Nodes nodes={tree} depth={0} prefix="g" h={h} /> : <p className="px-3 py-2 text-xs text-base-content/45">No music yet</p>}
          </Section>
          <Section title="Lists">
            <div className="-mt-4"><PlaylistTree active="" onPick={onList} onNew={onNewList} /></div>
          </Section>
          <Section title="Flows" action={<button onClick={onFlows} className="btn btn-ghost btn-xs">All</button>}>
            {flows.map(f => (
              <Row key={f.id} depth={0} icon={<Shape flow={f} w={22} h={14} dots={false} />} label={f.name} onClick={() => onFlow(f.id)} />
            ))}
          </Section>
          <Section title="Mixes" action={<button onClick={onMixes} className="btn btn-ghost btn-xs">All</button>}>
            {mixes.map(m => <Row key={m.id} depth={0} icon={<Ic name="list" size={13} />} label={m.name} onClick={() => onMix(m.id)} />)}
            {!mixes.length && <p className="px-3 py-1 text-xs text-base-content/45">Play a flow, then save what it made as a mix.</p>}
          </Section>
          <Section title="Online">
            {ONLINE.map(s => <Row key={s} depth={0} icon={<Ic name="search" size={13} />} label={<>{s} <i className="ml-1 text-[11px] not-italic text-base-content/45">type to search</i></>} dim />)}
          </Section>
        </div>
      </div>}
      <p className="border-t border-white/8 px-3 py-1.5 text-[11px] leading-snug text-base-content/45">Click opens it on the tape. Drag a track into your set. Double-click plays.</p>
    </div>
  )
}

function Section({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <details open className="group/sec">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 px-1.5 text-[11px] font-semibold tracking-wider text-base-content/55 marker:hidden">
        <Ic name="right" size={11} width={2.4} className="transition-transform group-open/sec:rotate-90" />
        <span className="uppercase">{title}</span>
        {hint && <i className="font-normal normal-case tracking-normal not-italic text-base-content/45">{hint}</i>}
        <span className="flex-1" />
        {action}
      </summary>
      {children}
    </details>
  )
}

/** `R: › Musique › Deadmau5 › Vexillology`, each part clickable, ↑ one folder up. */
function Address({ dir, libraries, tree, onOpen }: { dir?: GroupNode; libraries: LibraryStatus[]; tree: GroupNode[]; onOpen: (n: GroupNode) => void }) {
  if (!dir) return <div className="mx-1.5 mb-1 flex h-8 items-center gap-1.5 rounded-lg bg-white/5 px-2 text-xs text-base-content/45"><Ic name="folder" size={13} />Pick a folder, or open a library</div>
  const parts = dir.key.split('|')
  const lib = libraries.find(l => l.id === parts[0])
  const root = (lib?.path ?? lib?.label ?? parts[0]).split(/[\\/]/).filter(Boolean)
  const open = (k: string) => { const n = findNode(tree, k); if (n) onOpen(n) }
  const up = parts.length > 1 ? parts.slice(0, -1).join('|') : ''
  return (
    <div className="mx-1.5 mb-1 flex h-8 items-center gap-1 overflow-x-auto rounded-lg bg-white/5 px-2 text-xs no-scrollbar">
      <Ic name="folder" size={13} className="text-base-content/50" />
      {root.slice(0, -1).map((p, i) => <span key={i} className="flex items-center gap-1 text-base-content/40">{p}<span>›</span></span>)}
      <button onClick={() => open(parts[0])} className="rounded px-1 hover:bg-white/10">{root.at(-1)}</button>
      {parts.slice(1).map((p, i) => (
        <span key={i} className="flex items-center gap-1"><span className="text-base-content/40">›</span><button onClick={() => open(parts.slice(0, i + 2).join('|'))} className="rounded px-1 hover:bg-white/10">{p}</button></span>
      ))}
      <span className="flex-1" />
      <button onClick={() => open(up)} disabled={!up} aria-label="Up one folder" className="grid size-6 shrink-0 place-items-center rounded hover:bg-white/10 disabled:opacity-30"><Ic name="up" size={13} /></button>
    </div>
  )
}
