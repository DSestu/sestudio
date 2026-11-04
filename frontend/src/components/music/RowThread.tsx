import { useMusicQueue } from '../../musicQueue'
import { rawOf } from './mix/analysis'
import { usePosition } from './player'
import { drawThread, useCanvas, type Range } from './thread'

/** A queue row's thread along its bottom edge; the playing row's is lit up to where the music is. */
export default function RowThread({ id, dur, range, playing }: { id: string; dur: number; range: Range | null; playing: boolean }) {
  const raw = rawOf(id)
  if (!raw?.energy?.length || !range || !dur) return null
  return playing ? <PlayingThread id={id} dur={dur} range={range} /> : <Thread id={id} dur={dur} range={range} />
}

function Thread({ id, dur, range, lit }: { id: string; dur: number; range: Range; lit?: number }) {
  const ref = useCanvas((g, w, h) => { drawThread(g, rawOf(id), dur, range, 0, w, h, lit) }, [id, dur, range, lit])
  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[5px] w-full" />
}

function PlayingThread({ id, dur, range }: { id: string; dur: number; range: Range }) {
  const q = useMusicQueue()
  const pos = usePosition(q, dur)
  // Redrawn once a second at most: a bar is longer than that.
  return <Thread id={id} dur={dur} range={range} lit={Math.floor(pos)} />
}
