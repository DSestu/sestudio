import { useEffect, useMemo, useState } from 'react'
import { formatDuration, type MusicTrack } from '../../../musicLibrary'
import {
  isSet, itemsOf, locate, playlistApi, statsOf,
  type PartStats, type PlaylistItem, type PlaylistNode,
} from '../../../musicPlaylists'
import { playNow, playPayload, startPlayback } from '../player'
import { SmartForm } from './PlaylistTree'

const run = (p: Promise<unknown>) => { p.catch(e => window.alert((e as Error).message)) }
const blur = () => (document.activeElement as HTMLElement | null)?.blur()

function summary(s: PartStats): string {
  const bpm = s.bpmMin === undefined ? '' : s.bpmMin === s.bpmMax ? ` · ${Math.round(s.bpmMin)} bpm` : ` · ${Math.round(s.bpmMin)}–${Math.round(s.bpmMax!)} bpm`
  const dur = s.duration ? ` · ${formatDuration(s.duration)}` : ''
  return `${s.count} ${s.count === 1 ? 'track' : 'tracks'}${dur}${bpm}`
}

interface Drop { part: string | null; index: number }

interface RowProps {
  item: PlaylistItem
  track?: MusicTrack
  /** Position among its group, and where the menu can send it. */
  index: number
  last: boolean
  parts: { id: string; name: string }[]
  here: string | null
  onDragStart?: () => void
  onDropHere?: () => void
  onUp?: () => void
  onDown?: () => void
  onRemove?: () => void
  onToPart?: (part: string) => void
}

function Row({ item, track, parts, here, last, index, ...ev }: RowProps) {
  const title = track?.title ?? item.title ?? 'Missing track'
  const artist = track?.artist ?? item.artist ?? ''
  const duration = track?.duration ?? item.duration ?? 0
  const play = () => run(item.library === 'online' ? playPayload([{ library: item.library, track_id: item.track_id, source: item.source, title: item.title, artist: item.artist, duration: item.duration }]) : track ? playNow(track) : Promise.resolve())
  return (
    <li
      draggable={!!ev.onDragStart}
      onDragStart={ev.onDragStart}
      onDragOver={ev.onDropHere && (e => e.preventDefault())}
      onDrop={ev.onDropHere && (e => { e.preventDefault(); ev.onDropHere!() })}
      className="flex items-center gap-1 rounded-xl hover:bg-white/5"
    >
      <button onClick={play} className="flex-1 min-w-0 flex items-center gap-3 px-3 h-12 text-left">
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block truncate text-xs text-base-content/60">{artist}</span>
        </span>
        {item.library === 'online' && <span className="text-[11px] text-base-content/40">{item.source === 'ytmusic' ? 'YT Music' : 'YouTube'}</span>}
        {track?.bpm !== undefined && <span className="text-[11px] text-base-content/40 tabular-nums">{Math.round(track.bpm)} bpm</span>}
        <span className="w-10 text-right text-xs text-base-content/60 tabular-nums">{formatDuration(duration)}</span>
      </button>
      {ev.onRemove && (
        <div className="dropdown dropdown-end">
          <button tabIndex={0} aria-label={`Options for ${title}`} className="btn btn-ghost btn-circle btn-sm mr-1">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
          </button>
          <ul tabIndex={0} className="dropdown-content menu menu-sm z-30 w-52 rounded-xl bg-base-200 p-1 shadow-lg">
            {index > 0 && <li><button onClick={() => { blur(); ev.onUp!() }}>Move up</button></li>}
            {!last && <li><button onClick={() => { blur(); ev.onDown!() }}>Move down</button></li>}
            {parts.filter(p => p.id !== here).map(p => <li key={p.id}><button onClick={() => { blur(); ev.onToPart!(p.id) }}>Move to {p.name}</button></li>)}
            <li><button className="text-error" onClick={() => { blur(); ev.onRemove!() }}>Remove from playlist</button></li>
          </ul>
        </div>
      )}
    </li>
  )
}

/** A playlist's tracks (grouped by part for a set) or a smart list's matches. */
export default function PlaylistView({ node, byId }: { node: PlaylistNode; byId: ReadonlyMap<string, MusicTrack> }) {
  const [matches, setMatches] = useState<{ id: string; list: PlaylistItem[] }>()
  const [editing, setEditing] = useState(false)
  const [drag, setDrag] = useState<string>()
  const smart = node.kind === 'smart'
  const rulesKey = JSON.stringify(node.rules)
  useEffect(() => {
    if (!smart) return
    let live = true
    playlistApi.smartTracks(node.id).then(refs => {
      if (live) setMatches({ id: node.id + rulesKey, list: refs.map(r => ({ item_id: r.track_id, ...r })) })
    }, () => {})
    return () => { live = false }
  }, [smart, node.id, rulesKey])

  const items = smart ? (matches?.id === node.id + rulesKey ? matches.list : []) : itemsOf(node)
  const facts = (i: PlaylistItem) => {
    const t = byId.get(i.track_id)
    return t ? { duration: t.duration, bpm: t.bpm } : { duration: i.duration ?? 0 }
  }
  const total = useMemo(() => statsOf(items, facts), [items, byId]) // eslint-disable-line react-hooks/exhaustive-deps
  const parts = node.parts ?? []
  const groups: { id: string | null; name?: string; items: PlaylistItem[] }[] = isSet(node)
    ? parts.map(p => ({ id: p.id, name: p.name, items: p.items }))
    : [{ id: null, items }]
  const partRefs = parts.map(p => ({ id: p.id, name: p.name }))

  const drop = (to: Drop) => {
    const from = drag && locate(node, drag)
    setDrag(undefined)
    if (!drag || !from) return
    // The server removes the item before inserting, so a later slot of the same list shifts up.
    const index = from.part === to.part && from.index < to.index ? to.index - 1 : to.index
    run(playlistApi.moveItem(node.id, drag, index, to.part ?? undefined))
  }
  const shift = (i: PlaylistItem, part: string | null, at: number, by: number) =>
    run(playlistApi.moveItem(node.id, i.item_id, at + by, part ?? undefined))

  const playPart = (part?: string) => run(startPlayback(() => playlistApi.play(node.id, part).then(() => undefined)))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <div className="flex-1 min-w-40 leading-tight">
          <h2 className="truncate text-lg font-semibold">{node.name}</h2>
          <p className="text-xs text-base-content/60">
            {summary(total)}{isSet(node) && ` · ${parts.length} parts`}
            {smart && ' · fills itself from the rules'}
          </p>
        </div>
        {items.length > 0 && <button onClick={() => playPart()} className="btn btn-primary btn-sm">Play</button>}
        {smart ? (
          <button onClick={() => setEditing(true)} className="btn btn-ghost btn-sm">Edit rules</button>
        ) : (
          <button
            onClick={() => { const n = window.prompt(isSet(node) ? 'New part' : 'Split into parts: name of the new part', isSet(node) ? `Part ${parts.length + 1}` : 'Part 2'); if (n?.trim()) run(playlistApi.addPart(node.id, n)) }}
            className="btn btn-ghost btn-sm"
          >
            {isSet(node) ? 'Add a part' : 'Split into parts'}
          </button>
        )}
      </div>
      {!items.length && !parts.length ? (
        <p className="px-3 py-8 text-center text-sm text-base-content/60">
          {smart ? 'No track matches these rules yet.' : 'Empty. Add tracks with the + on any track row.'}
        </p>
      ) : (
        groups.map(g => {
          const part = parts.find(p => p.id === g.id)
          return (
            <section key={g.id ?? 'all'}>
              {part && (
                <div
                  className="flex items-center gap-2 px-3 pb-1 pt-1"
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); drop({ part: part.id, index: part.items.length }) }}
                >
                  <div className="flex-1 min-w-0 leading-tight">
                    <h3 className="truncate text-sm font-semibold">{part.name}</h3>
                    <p className="text-xs text-base-content/60">{summary(statsOf(part.items, facts))}</p>
                  </div>
                  <button onClick={() => playPart(part.id)} className="btn btn-ghost btn-xs">Play</button>
                  <button
                    onClick={() => { const n = window.prompt('Rename part', part.name); if (n?.trim()) run(playlistApi.renamePart(node.id, part.id, n)) }}
                    className="btn btn-ghost btn-xs"
                  >Rename</button>
                  <button
                    onClick={() => { if (window.confirm(`Remove ${part.name}? Its tracks join a neighbouring part.`)) run(playlistApi.removePart(node.id, part.id)) }}
                    className="btn btn-ghost btn-xs text-error"
                  >Remove</button>
                </div>
              )}
              <ul className={part && !g.items.length ? 'min-h-10 rounded-xl border border-dashed border-white/10' : ''}>
                {g.items.map((item, i) => (
                  <Row
                    key={item.item_id}
                    item={item}
                    track={byId.get(item.track_id)}
                    index={i}
                    last={i === g.items.length - 1}
                    parts={partRefs}
                    here={g.id}
                    {...(!smart && {
                      onDragStart: () => setDrag(item.item_id),
                      onDropHere: () => drop({ part: g.id, index: i }),
                      onUp: () => shift(item, g.id, i, -1),
                      onDown: () => shift(item, g.id, i, 1),
                      onRemove: () => run(playlistApi.removeItem(node.id, item.item_id)),
                      onToPart: (to: string) => run(playlistApi.moveItem(node.id, item.item_id, Number.MAX_SAFE_INTEGER, to)),
                    })}
                  />
                ))}
              </ul>
            </section>
          )
        })
      )}
      {editing && <SmartForm node={node} onClose={() => setEditing(false)} />}
    </div>
  )
}
