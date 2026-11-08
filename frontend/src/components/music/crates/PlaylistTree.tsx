import { useMemo, useState } from 'react'
import ResponsiveModal from '../../ResponsiveModal'
import {
  buildTree, isSet, playlistApi, usePlaylists, visibleRows,
  type PlaylistNode, type SmartRules, type TreeNode,
} from '../../../musicPlaylists'
import { startPlayback } from '../player'
import { MOOD_LADDER } from '../../../harmony'
import { EnergyLevel } from '../TrackMeta'

const run = (p: Promise<unknown>) => { p.catch(e => window.alert((e as Error).message)) }

/** The ids of a node and everything under it. */
function subtreeIds(n: TreeNode): Set<string> {
  return new Set([n.id, ...n.children.flatMap(c => [...subtreeIds(c)])])
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" /></svg>
  )
}

const blur = () => (document.activeElement as HTMLElement | null)?.blur()

function RowMenu({ node, folders }: { node: TreeNode; folders: TreeNode[] }) {
  const banned = subtreeIds(node)
  const targets = folders.filter(f => !banned.has(f.id) && f.id !== node.parent)
  const act = (fn: () => Promise<unknown>) => () => { blur(); run(fn()) }
  return (
    <div className="dropdown dropdown-end">
      <button tabIndex={0} aria-label={`Options for ${node.name}`} className="btn btn-ghost btn-circle btn-xs">
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      <ul tabIndex={0} className="dropdown-content menu menu-sm z-30 w-52 rounded-xl bg-base-200 p-1 shadow-lg">
        {node.kind !== 'folder' && (
          <li><button onClick={act(() => startPlayback(() => playlistApi.play(node.id).then(() => undefined)))}>Play</button></li>
        )}
        <li>
          <button onClick={act(async () => {
            const name = window.prompt('Rename', node.name)
            if (name?.trim()) await playlistApi.rename(node.id, name)
          })}>Rename</button>
        </li>
        {node.parent && <li><button onClick={act(() => playlistApi.move(node.id, null))}>Move to the top level</button></li>}
        {targets.map(f => <li key={f.id}><button onClick={act(() => playlistApi.move(node.id, f.id))}>Move to {f.name}</button></li>)}
        <li>
          <button className="text-error" onClick={act(async () => {
            const what = node.kind === 'folder' ? `${node.name} and everything in it` : node.name
            if (window.confirm(`Delete ${what}?`)) await playlistApi.remove(node.id)
          })}>Delete</button>
        </li>
      </ul>
    </div>
  )
}

const num = (v: string) => (v.trim() === '' ? null : Number(v))

/** Create or edit a smart list: genre, tempo range, added within N days, never played. */
export function SmartForm({ node, onClose }: { node?: PlaylistNode; onClose: () => void }) {
  const r = node?.rules
  const [name, setName] = useState(node?.name ?? '')
  const [genres, setGenres] = useState(r?.genres.join(', ') ?? '')
  const [min, setMin] = useState(r?.bpm_min?.toString() ?? '')
  const [max, setMax] = useState(r?.bpm_max?.toString() ?? '')
  const [days, setDays] = useState(r?.added_days?.toString() ?? '')
  const [never, setNever] = useState(r?.never_played ?? false)
  const [moodSide, setMoodSide] = useState<'' | 'max' | 'min'>(r?.mood_max != null ? 'max' : r?.mood_min != null ? 'min' : '')
  const [mood, setMood] = useState(String(r?.mood_max ?? r?.mood_min ?? -1))
  const [energy, setEnergy] = useState(r?.energy_min?.toString() ?? '')
  const save = () => {
    const rules: Partial<SmartRules> = {
      genres: genres.split(',').map(g => g.trim()).filter(Boolean),
      bpm_min: num(min), bpm_max: num(max), added_days: num(days), never_played: never,
      mood_max: moodSide === 'max' ? Number(mood) : null, mood_min: moodSide === 'min' ? Number(mood) : null,
      energy_min: num(energy),
    }
    run((node
      ? playlistApi.rename(node.id, name || node.name).then(() => playlistApi.setRules(node.id, rules))
      : playlistApi.create('smart', name || 'Smart list', null, rules)
    ).then(onClose))
  }
  const field = 'input input-bordered input-sm w-full'
  return (
    <ResponsiveModal onClose={onClose}>
      <h3 className="font-semibold mb-3">{node ? 'Edit smart list' : 'New smart list'}</h3>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs">Name
          <input className={field} value={name} onChange={e => setName(e.target.value)} placeholder="Smart list" />
        </label>
        <label className="flex flex-col gap-1 text-xs">Genre (comma separated, any of)
          <input className={field} value={genres} onChange={e => setGenres(e.target.value)} placeholder="House, Techno" />
        </label>
        <div className="flex gap-3">
          <label className="flex-1 flex flex-col gap-1 text-xs">BPM from
            <input className={field} type="number" min={0} value={min} onChange={e => setMin(e.target.value)} />
          </label>
          <label className="flex-1 flex flex-col gap-1 text-xs">to
            <input className={field} type="number" min={0} value={max} onChange={e => setMax(e.target.value)} />
          </label>
        </div>
        <div className="flex gap-3">
          <label className="flex-1 flex flex-col gap-1 text-xs">Mood
            <select className="select select-bordered select-sm w-full" value={moodSide} onChange={e => setMoodSide(e.target.value as typeof moodSide)}>
              <option value="">Any</option>
              <option value="max">This or darker</option>
              <option value="min">This or brighter</option>
            </select>
          </label>
          <label className="flex-1 flex flex-col gap-1 text-xs">is
            <select className="select select-bordered select-sm w-full" disabled={!moodSide} value={mood} onChange={e => setMood(e.target.value)}>
              {MOOD_LADDER.map(m => <option key={m.mode} value={m.brightness}>{m.word}</option>)}
            </select>
          </label>
        </div>
        {/* The level itself (SPEC-blend): a slider on the fixed energy scale, off at 0. */}
        <label className="flex flex-col gap-1 text-xs">Energy at least
          <span className="flex items-center gap-3">
            <input type="range" min={0} max={100} step={5} value={energy || 0} onChange={e => setEnergy(e.target.value === '0' ? '' : e.target.value)}
              aria-valuetext={energy ? `energy ${energy} of 100 or more` : 'any energy'} className="rn-level min-w-0 flex-1" />
            {energy ? <EnergyLevel value={Number(energy)} /> : <span className="w-14 text-base-content/50">Any</span>}
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs">Added within the last (days)
          <input className={field} type="number" min={0} value={days} onChange={e => setDays(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="checkbox checkbox-sm" checked={never} onChange={e => setNever(e.target.checked)} />
          Never played
        </label>
      </div>
      <div className="modal-action">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={save}>Save</button>
      </div>
    </ResponsiveModal>
  )
}

/** PLAYLISTS (folders, playlists, sets) and SMART LISTS under the libraries. */
export default function PlaylistTree({ active, onPick, onNew }: { active: string; onPick: (id: string) => void; onNew: () => void }) {
  const nodes = usePlaylists()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [form, setForm] = useState(false)
  const { rows, smart, folders } = useMemo(() => {
    const roots = buildTree(nodes)
    const all = visibleRows(roots, collapsed)
    const folderList: TreeNode[] = []
    const collect = (l: TreeNode[]) => l.forEach(n => { if (n.kind === 'folder') { folderList.push(n); collect(n.children) } })
    collect(roots)
    return { rows: all.filter(r => r.node.kind !== 'smart'), smart: nodes.filter(n => n.kind === 'smart').map(n => ({ ...n, children: [] })), folders: folderList }
  }, [nodes, collapsed])
  const toggle = (id: string) => setCollapsed(s => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n })
  const newFolder = () => {
    const name = window.prompt('New folder')
    if (name?.trim()) run(playlistApi.create('folder', name))
  }
  const cell = (n: TreeNode, depth: number, label: string) => (
    <li key={n.id} className="flex items-center" style={{ paddingLeft: depth * 14 }}>
      {n.kind === 'folder' ? (
        <button onClick={() => toggle(n.id)} aria-expanded={!collapsed.has(n.id)} className="flex-1 min-w-0 flex items-center gap-2 rounded-xl px-3 h-9 text-sm text-left hover:bg-white/5 text-base-content/80">
          <Chevron open={!collapsed.has(n.id)} />
          <span className="truncate">{n.name}</span>
        </button>
      ) : (
        <button
          onClick={() => onPick(n.id)}
          aria-current={n.id === active}
          className={`flex-1 min-w-0 flex items-center justify-between gap-2 rounded-xl px-3 h-9 text-sm text-left transition-colors ${
            n.id === active ? 'bg-primary/20 font-semibold' : 'hover:bg-white/5 text-base-content/80'
          }`}
        >
          <span className="truncate">{n.name}</span>
          <span className="shrink-0 text-xs text-base-content/50">{label}</span>
        </button>
      )}
      <RowMenu node={n} folders={folders} />
    </li>
  )
  const label = (n: TreeNode) => (isSet(n) ? `${n.parts!.length} parts` : n.kind === 'playlist' ? String(n.items?.length ?? 0) : '')
  return (
    <>
      <div className="mt-4">
        <div className="flex items-center justify-between px-3 pb-1">
          <h3 className="text-[11px] font-semibold tracking-wider text-base-content/50">PLAYLISTS</h3>
          <span className="flex gap-1">
            <button onClick={onNew} className="btn btn-ghost btn-xs">New playlist</button>
            <button onClick={newFolder} className="btn btn-ghost btn-xs">New folder</button>
          </span>
        </div>
        <ul className="flex flex-col gap-0.5">{rows.map(r => cell(r.node, r.depth, label(r.node)))}</ul>
      </div>
      <div className="mt-4">
        <div className="flex items-center justify-between px-3 pb-1">
          <h3 className="text-[11px] font-semibold tracking-wider text-base-content/50">SMART LISTS</h3>
          <button onClick={() => setForm(true)} className="btn btn-ghost btn-xs">New smart list</button>
        </div>
        <ul className="flex flex-col gap-0.5">{smart.map(n => cell(n, 0, ''))}</ul>
      </div>
      {form && <SmartForm onClose={() => setForm(false)} />}
    </>
  )
}
