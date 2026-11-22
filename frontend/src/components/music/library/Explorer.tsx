import type { LibraryStatus } from '../../../musicLibraries'
import { useFlows } from '../../../musicFlows'
import { applyPreset, setGrouping, toggleDim, useGrouping } from '../../../musicGrouping'
import { playlistApi, usePlaylists } from '../../../musicPlaylists'
import PlaylistTree, { SmartForm } from '../crates/PlaylistTree'
import { Shape } from '../flows/FlowRow'
import { Lit, Nodes, Row, type TreeHandlers } from './ExplorerTree'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { reducedMotion } from '../player'
import type { MusicTrack } from '../../../musicLibrary'
import { LINK_RE, setMusicQuery, useMusicQuery } from '../../../musicQuery'
import { OnlineSection } from './ExplorerSearch'
import QueryChips from './QueryChips'
import type { Query } from './searchWords'
import { DIMS, GROUP_SORTS, PRESETS, TRACK_SORTS, filterTree, findNode, groupingLabel, presetOf, sortLabel, type Dim, type GroupNode, type Preset } from './grouping'
import { Ic, type IconName } from './icons'
import RailPopover from './RailPopover'

// The explorer (SPEC-music-library §2.2): the icon rail, the Library tree for the grouping
// (a file explorer in Folders mode), Lists, Flows and Online. Its box is the Music page's one
// search: names and sound words narrow the tree in place, names also go online, a link opens.

const RAIL_ICON: Record<string, IconName> = {
  album: 'album', artist: 'user', files: 'disk', mood: 'mood', genre: 'tag', tempo: 'tempo', energy: 'bars', key: 'key', az: 'az', flat: 'list',
}
/** On the rail itself; the other presets and Custom live under More. */
const MAIN: Preset[] = ['files', 'album', 'artist', 'mood']
const MORE = PRESETS.filter(p => !MAIN.includes(p.id))

/** `pill`: a grouping button, lit by the rail's sliding pill instead of its own fill. */
const railBtn = (on: boolean, pill = false) =>
  `relative flex w-full flex-col items-center gap-1 rounded-lg py-1.5 text-[11px] leading-none ${on ? (pill ? 'text-primary' : 'bg-primary/15 text-primary') : 'text-base-content/70 hover:bg-white/5 hover:text-base-content'}`
const EASE = 'cubic-bezier(.2, .8, .2, 1)'
const menuBtn = (on: boolean) =>
  `flex w-full items-center gap-2 rounded-lg px-2 h-8 text-sm text-left ${on ? 'bg-primary/15 text-primary' : 'hover:bg-white/5'}`

/** Ask a name and make a playlist folder at the top level. */
const newFolder = () => {
  const name = window.prompt('New folder')
  if (name?.trim()) playlistApi.create('folder', name).catch(e => window.alert((e as Error).message))
}

/** The explorer's search box. */
const focusSearch = () =>
  [...document.querySelectorAll<HTMLInputElement>('input[aria-label="Search your libraries"]')].find(e => e.offsetParent)?.focus()

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
  onAddLibrary: () => void
  onClose?: () => void
  /** The search, parsed (a pasted link parses empty). */
  query: Query
  /** The whole tree cut to the sound words (mood, tempo), when the search has some. */
  soundTree?: GroupNode[]
  /** Library tracks answering the whole search: an online song you own plays your copy. */
  matched: MusicTrack[]
}

export default function Explorer({ tree, total, libraries, h, dir, onList, onNewList, onFlow, onFlows, onAddLibrary, onClose, query, soundTree, matched }: ExplorerProps) {
  const g = useGrouping()
  const preset = presetOf(g)
  const inMore = MORE.find(p => p.id === preset)
  const { flows } = useFlows()
  const lists = usePlaylists()
  const [smartForm, setSmartForm] = useState(false)
  const blur = () => (document.activeElement as HTMLElement | null)?.blur()
  const text = useMusicQuery()
  const words = query.terms
  // Sound words cut the tree first (the page does it), name words then narrow it in place (§2.2 Filter).
  const cut = useMemo(() => words.length ? filterTree(soundTree ?? tree, words)
    : soundTree && { nodes: soundTree, open: new Set<string>(), hits: soundTree.reduce((n, x) => n + x.all.length, 0) }, [tree, soundTree, words])
  // A pasted link opens as a card on the page; a phone closes the sheet to show it.
  const type = (v: string) => { setMusicQuery(v); if (onClose && LINK_RE.test(v.trim())) onClose() }
  const match = useMemo(() => words.length ? (name: string) => { const low = name.toLowerCase(); return words.every(w => low.includes(w)) } : undefined, [words])
  const shown = cut?.nodes ?? tree
  // While searching, Lists and Flows show only when something in them matches.
  const shownFlows = flows.filter(f => !match || match(f.name))
  const phone = !!onClose
  const sorted = g.groupSort !== 'natural' || g.trackSort !== 'natural'
  const label = groupingLabel(g)
  // The lit pill slides to the grouping picked (none on the first paint, so it doesn't fly in).
  const rail = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ top: number; h: number; slide: boolean }>()
  useLayoutEffect(() => {
    const b = rail.current?.querySelector<HTMLElement>(':scope > button[aria-pressed="true"]')
    setPill(p => b ? { top: b.offsetTop, h: b.offsetHeight, slide: !!p } : undefined)
  }, [label])
  // A new grouping rebuilds the tree: it fades in rather than snapping.
  const treeBox = useRef<HTMLDivElement>(null)
  const shownLabel = useRef(label)
  useLayoutEffect(() => {
    if (label === shownLabel.current) return
    shownLabel.current = label
    treeBox.current?.animate([{ opacity: 0.5 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' })
  }, [label])
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <b className="text-sm">Explorer</b>
        <small className="truncate text-xs text-base-content/60">{cut ? `${cut.hits} of ${total} tracks` : `${total} tracks`}</small>
        <span className="flex-1" />
        {h.addTo && (
          <span title={`+ and drops add to ${h.addTo}`} className="flex min-w-0 max-w-1/2 items-center gap-1 rounded-full bg-primary/15 px-2 h-6 text-xs text-primary">
            <span className="shrink-0 text-primary/80">Adds to</span>
            <b className="truncate font-medium">{h.addTo}</b>
          </span>
        )}
        {onClose && <button onClick={onClose} aria-label="Close" className="btn btn-ghost btn-circle size-11 shrink-0 -my-2 -mr-2"><Ic name="close" size={16} /></button>}
      </div>
      <label className={`input input-sm mx-3 mb-2 flex w-auto items-center gap-1.5 ${text ? 'input-primary' : ''}`}>
        <Ic name="search" size={14} className="shrink-0 text-base-content/60" />
        <QueryChips />
        <input type="text" value={text} onChange={e => type(e.target.value)} onKeyDown={e => { if (e.key === 'Escape' && text) { e.stopPropagation(); setMusicQuery('') } }}
          autoFocus={phone} placeholder="Search names or sounds, or paste a link" aria-label="Search your libraries" className="min-w-0 grow placeholder:text-base-content/60" />
        {text && <button onClick={() => setMusicQuery('')} aria-label="Clear the search" className="grid size-5 shrink-0 place-items-center rounded text-base-content/60 hover:text-base-content"><Ic name="close" size={13} /></button>}
      </label>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Group by" className="flex w-14 shrink-0 flex-col items-stretch gap-0.5 border-r border-white/8 px-1 pb-2">
          <div ref={rail} className="relative flex flex-col gap-0.5">
          {pill && <span aria-hidden="true" className={`absolute inset-x-0 top-0 rounded-lg bg-primary/15 ${pill.slide ? 'rail-pill' : ''}`} style={{ translate: `0 ${pill.top}px`, height: pill.h }} />}
          {MAIN.map(id => {
            const p = PRESETS.find(x => x.id === id)!
            return (
              <button key={id} onClick={() => applyPreset(id)} aria-pressed={preset === id} title={p.dims.length > 1 ? `${p.label} › ${p.dims.slice(1).map(d => DIMS[d].label).join(' › ')}` : p.label}
                className={railBtn(preset === id, true)}>
                <Ic name={RAIL_ICON[id]} size={17} /><span>{p.label}</span>
              </button>
            )
          })}
          <RailPopover label={inMore?.label ?? (preset ? 'More' : 'Custom')} title={`More groupings · now ${groupingLabel(g)}`} pressed={!!inMore || !preset} width="w-56"
            icon={<Ic name={inMore ? RAIL_ICON[inMore.id] : 'layers'} size={17} />} className={railBtn(!!inMore || !preset, true)}>
              <p className="px-1 pb-1 text-[11px] text-base-content/60">Group by</p>
              {MORE.map(p => (
                <button key={p.id} onClick={() => { applyPreset(p.id); blur() }} aria-pressed={preset === p.id} className={menuBtn(preset === p.id)}>
                  <Ic name={RAIL_ICON[p.id]} size={14} /><span className="flex-1">{p.label}</span>
                  {p.dims.length > 1 && <span className="text-[11px] text-base-content/60">› {p.dims.slice(1).map(d => DIMS[d].label).join(' › ')}</span>}
                </button>
              ))}
              <hr className="my-1 border-white/10" />
              <p className="px-1 pb-1 text-[11px] text-base-content/60">Custom · stack levels in order</p>
              {(Object.keys(DIMS) as Dim[]).map(d => {
                const i = g.files ? -1 : g.dims.indexOf(d)
                return (
                  <button key={d} onClick={() => toggleDim(d)} aria-pressed={i >= 0} className={menuBtn(i >= 0)}>
                    <Ic name={RAIL_ICON[d === 'letter' ? 'az' : d === 'library' ? 'files' : d]} size={14} /><span className="flex-1">{DIMS[d].label}</span>
                    {i >= 0 && <em className="grid size-4 place-items-center rounded-full bg-primary/25 text-[10px] not-italic">{i + 1}</em>}
                  </button>
                )
              })}
              <p className="px-1 pt-1 text-[11px] text-base-content/60">Now: {groupingLabel(g)}</p>
          </RailPopover>
          </div>
          <span className="flex-1" />
          <div className="border-t border-white/8 pt-1">
            <RailPopover label="Sort" title={`Sort: ${sortLabel(g)}`} pressed={sorted} width="w-48" icon={<Ic name="sort" size={17} />} className={railBtn(sorted)}>
                <p className="px-1 pb-1 text-[11px] text-base-content/60">Groups</p>
                {GROUP_SORTS.map(([k, l]) => <button key={k} onClick={() => setGrouping({ groupSort: k })} aria-pressed={g.groupSort === k} className={`block w-full rounded-lg px-2 h-7 text-left text-sm ${g.groupSort === k ? 'bg-primary/15 text-primary' : 'hover:bg-white/5'}`}>{l}</button>)}
                <p className="px-1 pt-2 pb-1 text-[11px] text-base-content/60">Tracks</p>
                {TRACK_SORTS.map(([k, l]) => <button key={k} onClick={() => setGrouping({ trackSort: k })} aria-pressed={g.trackSort === k} className={`block w-full rounded-lg px-2 h-7 text-left text-sm ${g.trackSort === k ? 'bg-primary/15 text-primary' : 'hover:bg-white/5'}`}>{l}</button>)}
            </RailPopover>
          </div>
        </nav>
        <div className="scroll-thin min-w-0 flex-1 overflow-y-auto px-1.5 pb-2 text-sm" onKeyDown={arrows}>
          {g.files && <Address dir={dir} libraries={libraries} tree={tree} onOpen={h.onOpen} />}
          <Section id="library" title="Library" hint={g.files ? 'folders' : `by ${groupingLabel(g).toLowerCase()}`}
            action={g.files ? <AddMenu label="Add to the library" items={[['Add a library', onAddLibrary]]} /> : undefined}>
            {shown.length
              ? <div ref={treeBox}><Nodes key={words.join(' ')} nodes={shown} depth={0} prefix="g" h={h} filter={cut && { open: cut.open, words }} /></div>
              : <p className="px-3 py-2 text-xs text-base-content/60">{cut ? `Nothing in your libraries matches “${text.trim()}”` : 'No music yet'}</p>}
          </Section>
          {(!match || lists.some(n => n.kind !== 'folder' && match(n.name))) && <Section id="lists" title="Lists"
            action={<AddMenu label="New list" items={[['New playlist', onNewList], ['New folder', newFolder], ['New smart list', () => setSmartForm(true)]]} />}>
            <div className="-mt-4"><PlaylistTree active="" onPick={onList} match={match} /></div>
          </Section>}
          {(!match || shownFlows.length > 0) && <Section id="flows" title="Flows" hint="fill a playlist" action={<button onClick={onFlows} className="btn btn-ghost btn-xs">All</button>}>
            {shownFlows.map(f => (
              <Row key={f.id} depth={0} icon={<Shape flow={f} w={22} h={14} dots={false} />} label={<Lit text={f.name} terms={words} />} onClick={() => onFlow(f.id)} />
            ))}
          </Section>}
          <Section id="online" title="Online">
            {words.length
              ? <OnlineSection query={query} matched={matched} h={h} />
              : <Row depth={0} icon={<Ic name="search" size={13} />} onClick={focusSearch}
                  label={<>Search online <i className="ml-1 text-[11px] not-italic text-base-content/60">type a name above: YouTube Music, YouTube, SoundCloud</i></>} />}
          </Section>
        </div>
      </div>
      <p className="border-t border-white/8 px-3 py-1.5 text-[11px] leading-snug text-base-content/60">
        {phone ? 'Tap opens it on the tape.' : 'Click opens it on the tape, double-click plays. ↑ ↓ move, → ← fold.'}
      </p>
      {smartForm && <SmartForm onClose={() => setSmartForm(false)} />}
    </div>
  )
}

/** ↑ ↓ walk the rows, → unfolds and ← folds the focused one (the chevrons stay out of the Tab order). */
function arrows(e: React.KeyboardEvent<HTMLElement>) {
  const el = e.target as HTMLElement
  if (!el.matches('[data-row]')) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-row]')].filter(r => r.offsetParent)
    e.preventDefault()
    rows[rows.indexOf(el) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus()
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const chev = el.parentElement?.querySelector<HTMLButtonElement>('[data-chev]')
    if (chev && (chev.getAttribute('aria-expanded') === 'true') === (e.key === 'ArrowLeft')) { e.preventDefault(); chev.click() }
  }
}

/** One + per section header, in place of a row of "New …" links. */
function AddMenu({ label, items }: { label: string; items: [string, () => void][] }) {
  const pick = (fn: () => void) => () => { (document.activeElement as HTMLElement | null)?.blur(); fn() }
  return (
    <div className="dropdown dropdown-end">
      <button tabIndex={0} aria-label={label} title={label} className="btn btn-ghost btn-circle btn-xs"><Ic name="plus" size={13} width={2.2} /></button>
      <ul tabIndex={0} className="dropdown-content menu menu-sm z-30 w-44 rounded-xl bg-base-300 p-1 font-normal normal-case tracking-normal text-base-content shadow-xl">
        {items.map(([l, fn]) => <li key={l}><button onClick={pick(fn)}>{l}</button></li>)}
      </ul>
    </div>
  )
}

const FOLD_KEY = 'sestudio.explorer.folded'
const readFolded = (): string[] => { try { return JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]') } catch { return [] } }

/** A section that remembers being folded. */
function Section({ id, title, hint, action, children }: { id: string; title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(() => !readFolded().includes(id))
  const body = useRef<HTMLDivElement>(null)
  const toggle = (now: boolean) => {
    setOpen(now)
    // Opened by hand: the content drops out of the header (not on load, not when folding).
    if (now && !reducedMotion()) body.current?.animate([{ opacity: 0.5, translate: '0 -3px' }, { opacity: 1, translate: '0 0' }], { duration: 140, easing: EASE })
    try { localStorage.setItem(FOLD_KEY, JSON.stringify([...readFolded().filter(k => k !== id), ...(now ? [] : [id])])) } catch { /* private mode: folds just aren't kept */ }
  }
  return (
    <details open={open} onToggle={e => { if (e.currentTarget.open !== open) toggle(e.currentTarget.open) }} className="group/sec">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 px-1.5 text-[11px] font-semibold tracking-wider text-base-content/60 marker:hidden">
        <Ic name="right" size={11} width={2.4} className="transition-transform group-open/sec:rotate-90" />
        <span className="uppercase">{title}</span>
        {hint && <i className="font-normal normal-case tracking-normal not-italic text-base-content/60">{hint}</i>}
        <span className="flex-1" />
        {/* a click on the action must not fold the section */}
        {action && <span onClick={e => e.preventDefault()}>{action}</span>}
      </summary>
      <div ref={body}>{children}</div>
    </details>
  )
}

/** `R: › Musique › Deadmau5 › Vexillology`, each part clickable, ↑ one folder up. */
function Address({ dir, libraries, tree, onOpen }: { dir?: GroupNode; libraries: LibraryStatus[]; tree: GroupNode[]; onOpen: (n: GroupNode) => void }) {
  if (!dir) return <div className="mx-1.5 mb-1 flex h-8 items-center gap-1.5 rounded-lg bg-white/5 px-2 text-xs text-base-content/60"><Ic name="folder" size={13} />Pick a folder, or open a library</div>
  const parts = dir.key.split('|')
  const lib = libraries.find(l => l.id === parts[0])
  const root = (lib?.path ?? lib?.label ?? parts[0]).split(/[\\/]/).filter(Boolean)
  const open = (k: string) => { const n = findNode(tree, k); if (n) onOpen(n) }
  const up = parts.length > 1 ? parts.slice(0, -1).join('|') : ''
  return (
    <div className="mx-1.5 mb-1 flex h-8 items-center gap-1 overflow-x-auto rounded-lg bg-white/5 px-2 text-xs no-scrollbar">
      <Ic name="folder" size={13} className="text-base-content/60" />
      {root.slice(0, -1).map((p, i) => <span key={i} className="flex items-center gap-1 text-base-content/60">{p}<span>›</span></span>)}
      <button onClick={() => open(parts[0])} className="rounded px-1 hover:bg-white/10">{root.at(-1)}</button>
      {parts.slice(1).map((p, i) => (
        <span key={i} className="flex items-center gap-1"><span className="text-base-content/60">›</span><button onClick={() => open(parts.slice(0, i + 2).join('|'))} className="rounded px-1 hover:bg-white/10">{p}</button></span>
      ))}
      <span className="flex-1" />
      <button onClick={() => open(up)} disabled={!up} aria-label="Up one folder" className="grid size-6 shrink-0 place-items-center rounded hover:bg-white/10 disabled:opacity-30"><Ic name="up" size={13} /></button>
    </div>
  )
}
