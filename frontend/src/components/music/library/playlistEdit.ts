import { useMemo, useSyncExternalStore } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import { blendBody } from '../../../musicBlendWeights'
import { itemsOf, locate, playlistApi, type Edited, type PlaylistItem, type PlaylistNode } from '../../../musicPlaylists'
import { addPayload, getQueue, playlistRunOf } from '../../../musicQueue'
import { toast } from '../toast'
import { analyseOnline } from '../edit/onlineAnalysis'
import { followPlaylist } from './setQueue'
import { keepOrder, useBlendOrder } from './blendOrder'
import { autoOrder, ORDERS, type OrderMode } from '../crates/setBuilder'
import { loadAnalyses, setTrackOf } from '../mix/analysis'

// Editing the playlist open on the board (SPEC-blend-playlists §3.1): every edit goes to the
// server with Blend by, a blend playlist answers with the rows its re-order moved (a dot for
// 4 s) and the toast carries an Undo that puts the playlist back exactly as it was.

export const MOVED_MS = 4000

let movedNow: ReadonlySet<string> = new Set()
let timer = 0
const listeners = new Set<() => void>()
export function markMoved(ids: string[]) {
  window.clearTimeout(timer)
  movedNow = new Set(ids)
  listeners.forEach(l => l())
  if (ids.length) timer = window.setTimeout(() => markMoved([]), MOVED_MS)
}
/** The item ids a re-order moved in the last few seconds. */
export const useMoved = () => useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => movedNow)

/** Where an item lands in a list of `ids` when taken out and dropped at slot `to` (counted before it left). */
export const indexAfterRemoval = (ids: readonly string[], id: string, to: number) => ids.slice(0, to).filter(x => x !== id).length

/** `ids` with the `block` taken out and put at slot `to` (counted on `ids`), in the block's order there. */
export function withBlockAt(ids: readonly string[], block: readonly string[], to: number): string[] {
  const moving = new Set(block)
  const inOrder = ids.filter(x => moving.has(x))
  return [...ids.slice(0, to).filter(x => !moving.has(x)), ...inOrder, ...ids.slice(to).filter(x => !moving.has(x))]
}

const count = (n: number) => `${n} ${n === 1 ? 'track' : 'tracks'}`

/** Blend by, and while the playlist plays (the queue is on its run) how many rows are fixed: the played ones and the playing one. */
function body(node: PlaylistNode) {
  const q = getQueue()
  const playing = playlistRunOf(q)?.playlist === node.id ? q.items[q.current] : undefined
  const at = playing ? itemsOf(node).findIndex(i => i.track_id === playing.track_id) : -1
  return { ...blendBody(), start: at + 1 }
}

/** Run an edit: mark what it moved or added, say what it did, and offer Undo (the playlist as it was). While the playlist plays, the queue after the playing track follows its new order. */
async function edit(prev: PlaylistNode, text: string | ((r: Edited) => string), call: () => Promise<Edited>) {
  try {
    const locked = playlistRunOf(getQueue())?.playlist === prev.id
    const r = await call()
    const moved = r.moved ?? []
    markMoved([...moved, ...(r.added ?? [])])
    if (locked) await followPlaylist(itemsOf(r))
    const said = typeof text === 'function' ? text(r) : text
    const rows = itemsOf(r).flatMap((i, k) => (moved.includes(i.item_id) ? [k + 1] : []))
    const msg = !locked ? `${said}${moved.length ? ` · ${count(moved.length)} moved` : ''}`
      : rows.length ? `Re-blended ${rows[0]}–${rows[rows.length - 1]} · playing track unchanged` : `${said} · playing track unchanged`
    toast(msg, () => {
      markMoved([])
      playlistApi.restore(prev).then(back => (locked ? followPlaylist(itemsOf(back)) : undefined)).catch((e: Error) => toast(e.message))
    })
  } catch (e) {
    toast((e as Error).message)
  }
}

/** Add about `minutes` of a flow's tracks (SPEC D2); the new rows are marked like moved ones. */
export const fillFrom = (node: PlaylistNode, flow: { id: string; name: string }, minutes: number, useShape: boolean) =>
  edit(node, r => `Added ${count(r.added?.length ?? 0)} from ${flow.name}`, () =>
    playlistApi.fill(node.id, { flow: flow.id, minutes, use_shape: useShape, ...body(node) }))

/** Add tracks not in yet: at `index` they are pinned there (a drop), at the end Blend places them. */
export function addTo(node: PlaylistNode, tracks: MusicTrack[], label: string, index?: number) {
  const have = new Set(itemsOf(node).map(i => i.track_id))
  const fresh = tracks.filter((t, i) => !have.has(t.id) && tracks.findIndex(x => x.id === t.id) === i)
  if (!fresh.length) { toast(`${label} is already in ${node.name}`); return }
  for (const t of fresh) if (t.library === 'online') void analyseOnline(t.id) // its joins fill in as it is read
  const where = index === undefined ? '' : ` at ${index + 1}`
  return edit(node, `${label}${fresh.length > 1 ? ` · ${count(fresh.length)}` : ''}${node.blend && index !== undefined ? ' pinned' : ' added'}${where}`,
    () => playlistApi.add(node.id, addPayload(fresh, 'append').tracks, undefined, index, body(node)))
}

export const removeItems = (node: PlaylistNode, itemIds: string[]) =>
  edit(node, `Removed ${count(itemIds.length)}`, async () => {
    let last: Edited = node
    const moved = new Set<string>()
    for (const id of itemIds) {
      last = await playlistApi.removeItem(node.id, id, body(node))
      last.moved?.forEach(m => moved.add(m))
    }
    return { ...last, moved: [...moved] }
  })

export const moveItem = (node: PlaylistNode, itemId: string, index: number) =>
  edit(node, node.blend ? `Pinned at ${index + 1}` : `Moved to ${index + 1}`, () => playlistApi.moveItem(node.id, itemId, index, undefined, body(node)))

/** A block of items to slot `to` of the order on screen. */
export const moveBlock = (node: PlaylistNode, block: string[], to: number) =>
  edit(node, `${count(block.length)} moved`, () =>
    playlistApi.reorder(node.id, withBlockAt(itemsOf(node).map(i => i.item_id), block, to), undefined, true, body(node)))

/** Swap an item for another track: the new one goes where the old one was, pinned, and the old one leaves. */
export function swapItem(node: PlaylistNode, itemId: string, track: MusicTrack) {
  const at = itemsOf(node).findIndex(i => i.item_id === itemId)
  return edit(node, `${track.title} ${node.blend ? 'pinned ' : ''}at ${at + 1}`, async () => {
    const added = await playlistApi.add(node.id, addPayload([track], 'append').tracks, undefined, at, body(node))
    const gone = await playlistApi.removeItem(node.id, itemId, body(node))
    return { ...gone, moved: [...new Set([...(added.moved ?? []), ...(gone.moved ?? [])])].filter(id => id !== itemId) }
  })
}

export const setBlend = (node: PlaylistNode, on: boolean) =>
  edit(node, on ? 'Blend on' : 'Hand order: nothing moves on its own', () => playlistApi.patch(node.id, { blend: on, ...body(node) }))

export const setShape = (node: PlaylistNode, shape: string) =>
  edit(node, `Shape ${shape}`, () => playlistApi.patch(node.id, { shape, ...body(node) }))

export const reblend = (node: PlaylistNode, full = false, text = full ? 'Re-blended all' : 'Re-blended') =>
  edit(node, text, () => playlistApi.blend(node.id, { full, ...body(node) }))

/** Auto-order (Harmonic path, Smooth tempo, Energy arc): a blend playlist goes to Hand order first so the order stays as sorted; the played rows keep their place. */
export const autoOrderBy = (node: PlaylistNode, mode: OrderMode) =>
  edit(node, `Ordered by ${ORDERS.find(o => o[0] === mode)![1].toLowerCase()}${node.blend ? ' · Hand order' : ''}`, async () => {
    const o = body(node)
    if (node.blend) await playlistApi.patch(node.id, { blend: false, ...o })
    const items = itemsOf(node)
    await loadAnalyses(items.map(i => i.track_id)) // tempo, key and energy the sort reads
    const ids = items.map(i => i.item_id)
    const sorted = autoOrder(items.slice(o.start).map(i => setTrackOf(i.track_id, i.duration ?? 0, undefined, i.item_id)), mode)
    return playlistApi.reorder(node.id, [...ids.slice(0, o.start), ...sorted], undefined, true, o)
  })

/** Pin an item where it is, or let go of its pin (the order does not change). */
export function togglePin(node: PlaylistNode, itemId: string) {
  const pins = { ...node.pins }
  if (itemId in pins) delete pins[itemId]
  else pins[itemId] = locate(node, itemId)?.index ?? 0
  return playlistApi.restore({ ...node, pins }).catch((e: Error) => toast(e.message))
}

export interface PRow { item: PlaylistItem; track: MusicTrack }

/** An item whose track is not in the libraries (a streamed one) as the lists show it. */
const streamed = (i: PlaylistItem): MusicTrack => ({
  id: i.track_id, library: i.library, libraryLabel: '', source: i.source, title: i.title ?? 'Unknown track', artist: i.artist ?? '', album: '', duration: i.duration ?? 0, folder: '',
})

/** The playlist's rows in its stored order and the joins between them (the server reads them with every track pinned). */
export function usePlaylistView(node: PlaylistNode | undefined, byId: ReadonlyMap<string, MusicTrack>) {
  const rows = useMemo<PRow[]>(() => (node ? itemsOf(node).map(item => ({ item, track: byId.get(item.track_id) ?? streamed(item) })) : []), [node, byId])
  const tracks = useMemo(() => rows.map(r => r.track), [rows])
  const res = useBlendOrder(node ? tracks : undefined, 'Arc', keepOrder(tracks))
  return { rows, tracks, res, joins: res?.joins }
}
export type PlaylistView = ReturnType<typeof usePlaylistView>


export const SHAPE_HINT: Record<string, string> = { Hold: 'stay level', Lift: 'rise', Ease: 'come down', Arc: 'rise and fall' }

// Joins the user keeps as they are (`a>b` track ids): they stop counting as problems. Kept in this browser.
const KEPT = 'music.kept'
function readKept(): string[] {
  try { return JSON.parse(localStorage.getItem(KEPT) ?? '[]') as string[] } catch { return [] }
}
let kept = readKept()
const keptListeners = new Set<() => void>()
function setKept(next: string[]) {
  kept = next
  try { localStorage.setItem(KEPT, JSON.stringify(next)) } catch { /* private mode: kept for this session */ }
  keptListeners.forEach(l => l())
}
export const useKept = (): string[] => useSyncExternalStore(l => { keptListeners.add(l); return () => keptListeners.delete(l) }, () => kept)
export const joinKey = (a: { id: string }, b: { id: string }) => `${a.id}>${b.id}`
export const keepJoin = (key: string) => setKept([...kept, key])
export const unkeepJoin = (key: string) => setKept(kept.filter(k => k !== key))
