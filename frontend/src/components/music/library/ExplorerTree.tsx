import { useState, type ReactNode } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import { dragProps } from '../edit/focus'
import { fmtTime } from '../format'
import type { Facts } from './facts'
import { fileName, type GroupNode } from './grouping'
import { trackColor, type Colour } from './sigil'
import { carryProps } from './carry'
import { Ic, type IconName } from './icons'

// The explorer's tree (SPEC-music-library §2.2): group rows with a chevron, an icon, the
// name (click opens it on the tape), a count that turns into + on hover; track rows under
// the leaves. Lists show 8 groups at the top then "N more"; Mood, Tempo and Energy show all.

const GROUPS_SHOWN = 8
const DEEP_SHOWN = 40
const TRACKS_SHOWN = 12
const FILES_SHOWN = 40
const FLOW_KINDS = new Set<GroupNode['kind']>(['album', 'artist', 'library', 'genre'])
const ALL_SHOWN = new Set(['mood', 'tempo', 'energy'])

const ICON: Record<GroupNode['kind'], IconName> = {
  album: 'album', artist: 'user', library: 'disk', folder: 'folder', mood: 'mood', genre: 'tag',
  tempo: 'tempo', energy: 'bars', key: 'key', letter: 'az', all: 'list',
}

export interface TreeHandlers {
  /** The open source: lit in the tree. */
  sourceKey?: string
  onOpen: (n: GroupNode) => void
  /** + on a row: the node's tracks, or one track. */
  onAdd: (tracks: MusicTrack[], label: string) => void
  onTrack: (t: MusicTrack, list: MusicTrack[]) => void
  facts: Facts
  colour: Colour
  /** The playing track, lit in the tree. */
  playingId?: string
  /** Play a group as a flow (§2.2 doors): albums, artists, libraries and genres. */
  onFlowDoor?: (n: GroupNode, at: DOMRect) => void
  hoverProps?: (t: MusicTrack) => object
}

export function Row({ depth, chevron, onChevron, icon, label, count, onClick, onDouble, onAdd, active, dim, drag, title, extra, tool }: {
  depth: number
  /** undefined: no chevron (a track); else open or shut. */
  chevron?: boolean
  onChevron?: () => void
  icon: ReactNode
  label: ReactNode
  count?: ReactNode
  onClick?: () => void
  onDouble?: () => void
  onAdd?: () => void
  active?: boolean
  dim?: boolean
  drag?: Record<string, unknown>
  title?: string
  extra?: object
  /** A hover tool before the +, like Play as a flow. */
  tool?: ReactNode
}) {
  return (
    <div
      className={`group flex h-8 items-center gap-1 rounded-lg pr-1 text-[13px] ${active ? 'bg-primary/15 text-primary' : 'hover:bg-white/5'} ${dim ? 'text-base-content/45' : ''}`}
      style={{ paddingLeft: 4 + depth * 14 }}
      {...drag}
      {...extra}
    >
      <button
        onClick={onChevron}
        tabIndex={chevron === undefined ? -1 : 0}
        aria-label={chevron === undefined ? undefined : chevron ? 'Fold' : 'Unfold'}
        className={`grid size-5 shrink-0 place-items-center rounded text-base-content/50 ${chevron === undefined ? 'invisible' : 'hover:text-base-content'}`}
      >
        <Ic name="right" size={12} width={2.4} className={`transition-transform ${chevron ? 'rotate-90' : ''}`} />
      </button>
      <span className="grid size-5 shrink-0 place-items-center text-base-content/60">{icon}</span>
      <button onClick={onClick} onDoubleClick={onDouble} title={title} className="min-w-0 flex-1 truncate text-left leading-tight">{label}</button>
      {tool && <span className="hidden group-hover:contents">{tool}</span>}
      {count !== undefined && <span className={`shrink-0 tabular-nums text-[11px] text-base-content/50 ${onAdd ? 'group-hover:hidden' : ''}`}>{count}</span>}
      {onAdd && (
        <button onClick={onAdd} aria-label="Add to your set" title="Add to your set" className="hidden size-6 shrink-0 place-items-center rounded-md text-base-content/70 hover:bg-white/10 hover:text-base-content group-hover:grid">
          <Ic name="plus" size={13} width={2.2} />
        </button>
      )}
    </div>
  )
}

export function TrackRow({ t, depth, list, file, h, terms, sub }: { t: MusicTrack; depth: number; list: MusicTrack[]; file?: boolean; h: TreeHandlers; terms?: string[]; sub?: string }) {
  const f = h.facts(t.id)
  const name = file ? fileName(t) : t.title
  return (
    <Row
      depth={depth}
      icon={<span className="size-2.5 rounded-sm" style={{ background: trackColor(f, h.colour) }} />}
      label={<>
        {file ? <FileLabel name={name} /> : <Lit text={name} terms={terms} />}
        {sub && <i className="ml-1.5 text-[11px] not-italic text-base-content/50">{sub}</i>}
        {file && t.title !== name.replace(/\.[^.]+$/, '') && <i className="ml-1.5 text-[11px] not-italic text-base-content/50">{t.title}</i>}
        {f.bpm ? <i className="ml-1.5 text-[11px] not-italic tabular-nums text-base-content/50">{Math.round(f.bpm)}</i> : null}
      </>}
      count={fmtTime(t.duration)}
      onClick={() => h.onTrack(t, list)}
      onAdd={() => h.onAdd([t], t.title)}
      active={h.playingId === t.id}
      drag={dragProps(t)}
      title={t.path}
      extra={h.hoverProps?.(t)}
    />
  )
}

/** "vexillology" + a small MP3 badge. */
function FileLabel({ name }: { name: string }) {
  const i = name.lastIndexOf('.')
  const ext = i > 0 ? name.slice(i + 1) : ''
  return <>{i > 0 ? name.slice(0, i) : name}{ext && <em className="ml-1 rounded bg-white/10 px-1 text-[9px] font-semibold uppercase not-italic text-base-content/60">{ext}</em>}</>
}

function More({ depth, n, onClick }: { depth: number; n: number; onClick: () => void }) {
  return <Row depth={depth} icon={null} label={`${n} more`} onClick={onClick} dim />
}

/** The group rows at one level, with their children when open. */
export function Nodes({ nodes, depth, prefix, h }: { nodes: GroupNode[]; depth: number; prefix: string; h: TreeHandlers }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [more, setMore] = useState<ReadonlySet<string>>(new Set())
  const grow = (k: string) => setMore(s => new Set(s).add(k))
  const toggle = (k: string) => setOpen(s => { const n = new Set(s); if (!n.delete(k)) n.add(k); return n })
  const lim = more.has(prefix) || ALL_SHOWN.has(nodes[0]?.kind) ? Infinity : depth === 0 ? GROUPS_SHOWN : DEEP_SHOWN
  return (
    <>
      {nodes.slice(0, lim).map(n => {
        const on = open.has(n.key)
        const files = n.files
        const tracks = files ?? (n.kids ? [] : n.all)
        const shown = more.has(n.key) ? Infinity : files ? FILES_SHOWN : TRACKS_SHOWN
        return (
          <div key={n.key}>
            <Row
              depth={depth}
              chevron={on}
              onChevron={() => toggle(n.key)}
              icon={<Ic name={ICON[n.kind]} size={14} />}
              label={n.name}
              count={n.all.length}
              onClick={() => h.onOpen(n)}
              onAdd={() => h.onAdd(n.all, n.name)}
              tool={h.onFlowDoor && FLOW_KINDS.has(n.kind) ? (
                <button onClick={e => h.onFlowDoor!(n, e.currentTarget.getBoundingClientRect())} aria-label={`Play ${n.name} as a flow`} title="Play as a flow" className="grid size-6 shrink-0 place-items-center rounded-md text-base-content/70 hover:bg-white/10 hover:text-base-content"><Ic name="flow" size={13} /></button>
              ) : undefined}
              active={h.sourceKey === n.key}
              drag={carryProps(n.all, n.name)}
            />
            {on && n.kids && <Nodes nodes={n.kids} depth={depth + 1} prefix={n.key} h={h} />}
            {on && tracks.slice(0, shown).map(t => <TrackRow key={t.id} t={t} depth={depth + 1} list={tracks} file={!!files} h={h} />)}
            {on && tracks.length > shown && <More depth={depth + 1} n={tracks.length - shown} onClick={() => grow(n.key)} />}
          </div>
        )
      })}
      {nodes.length > lim && <More depth={depth} n={nodes.length - lim} onClick={() => grow(prefix)} />}
    </>
  )
}

/** `text` with the first match of each search word lit. */
export function Lit({ text, terms }: { text: string; terms?: string[] }) {
  if (!terms?.length) return <>{text}</>
  const low = text.toLowerCase()
  const spans = terms.map(w => [low.indexOf(w), w.length] as const).filter(([i]) => i >= 0).sort((a, b) => a[0] - b[0])
  const out: React.ReactNode[] = []
  let at = 0
  for (const [i, n] of spans) {
    if (i < at) continue
    out.push(text.slice(at, i), <mark key={i} className="rounded-sm bg-primary/30 text-inherit">{text.slice(i, i + n)}</mark>)
    at = i + n
  }
  out.push(text.slice(at))
  return <>{out}</>
}
