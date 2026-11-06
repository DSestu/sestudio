import { useState } from 'react'
import { createPortal } from 'react-dom'
import { getQueue, queueActions, type QueueItem, type TrackInfo } from '../../musicQueue'
import ResponsiveModal from '../ResponsiveModal'
import { useModalBack } from '../../useModalBack'
import { autoOrder, countJoins, ORDERS, type OrderMode } from './crates/setBuilder'
import { setTrackOf } from './mix/analysis'
import { saveAsPlaylist } from './saveList'
import { toast } from './toast'

const HELP: Record<OrderMode, string> = {
  harmonic: 'Each next track joins the one before it best, starting from the playing one.',
  tempo: 'Slowest to fastest.',
  energy: 'A rise to the most intense track, then a fall.',
}

/** The queue's tools: reorder what comes after the playing track, or keep the queue as a playlist. */
export default function QueueActions({ info }: { info: (id: string) => TrackInfo | undefined }) {
  const [open, setOpen] = useState(false)
  useModalBack(open, () => setOpen(false))
  const q = getQueue()
  const next = q.items.length - (q.current + 1)

  const order = (mode: OrderMode) => {
    setOpen(false)
    // The live queue at the moment of the tap: the played and playing rows stay where they are.
    const s = getQueue()
    const head = s.items.slice(0, s.current + 1)
    const rest = s.items.slice(s.current + 1)
    const now = s.items[s.current]
    const set = (i: QueueItem) => setTrackOf(i.track_id, info(i.track_id)?.duration ?? 0, undefined, i.item_id)
    const ids = mode === 'harmonic' && now ? autoOrder([now, ...rest].map(set), mode).slice(1) : autoOrder(rest.map(set), mode)
    const byId = new Map(rest.map(i => [i.item_id, i]))
    const { clashes } = countJoins([...(now ? [now] : []), ...ids.map(id => byId.get(id)!)].map(set))
    const name = ORDERS.find(o => o[0] === mode)![1].toLowerCase()
    void queueActions.order([...head.map(i => i.item_id), ...ids])
      .then(() => toast(`Ordered what's next by ${name}: ${clashes === 0 ? 'no clash' : `${clashes} ${clashes === 1 ? 'clash' : 'clashes'}`}`))
  }
  const save = () => {
    setOpen(false)
    void saveAsPlaylist('Queue', getQueue().items.map(i => ({
      library: i.library, track_id: i.track_id, source: i.source, title: i.title, artist: i.artist, duration: i.duration,
    })))
  }

  const btn = 'btn h-auto min-h-11 justify-start rounded-xl py-2 text-left font-normal'
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Queue actions" title="Queue actions" className="grid size-[26px] shrink-0 place-items-center rounded-[9px] text-base-content/60 hover:bg-white/10 max-md:size-11">
        <svg className="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
      </button>
      {/* Portalled: the player's layers are transformed, which would trap a fixed sheet inside them. */}
      {open && createPortal(
        <ResponsiveModal onClose={() => setOpen(false)} boxClassName="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Order what's next</h2>
          <p className="-mt-2 text-xs text-base-content/60">
            {next > 1 ? `The ${next} tracks after the playing one. Played and playing tracks stay where they are.` : 'Queue at least two tracks after the playing one to reorder them.'}
          </p>
          {ORDERS.map(([mode, label]) => (
            <button key={mode} disabled={next < 2} onClick={() => order(mode)} className={btn}>
              <span className="flex flex-col">
                <span className="font-medium">{label}</span>
                <span className="text-xs text-base-content/60">{HELP[mode]}</span>
              </span>
            </button>
          ))}
          <div className="divider my-0" />
          <button disabled={!q.items.length} onClick={save} className={btn}>
            <span className="flex flex-col">
              <span className="font-medium">Save as playlist</span>
              <span className="text-xs text-base-content/60">All {q.items.length} tracks, in this order.</span>
            </span>
          </button>
          <button onClick={() => setOpen(false)} className="btn btn-ghost min-h-11">Close</button>
        </ResponsiveModal>,
        document.body,
      )}
    </>
  )
}
