// The player's frame loops draw only while something moves. A loop whose frame
// came out the same as the last few goes to sleep; `wake` (a press, a resize, a
// queue or mode change, a new look) starts every sleeping loop again.

const QUIET = 8
const wakers = new Set<() => void>()

export const wake = () => wakers.forEach(w => w())

// The closed player stays in the page, hidden: its loops sleep until it shows again.
let paused = false
export function pauseLoops(p: boolean) {
  if (paused === p) return
  paused = p
  if (!p) wake()
}

/** Run `step` every frame (at most `fps()` per second when that gives one) until it reports nothing moving for a few frames; returns the stop function. */
export function frameLoop(step: (now: number) => boolean, fps?: () => number): () => void {
  let id = 0
  let quiet = 0
  let last = -1e9
  const tick = (now: number) => {
    if (paused) { id = 0; return }
    id = requestAnimationFrame(tick)
    const cap = fps?.() ?? 0
    if (cap && now - last < 1000 / cap - 4) return
    last = now
    quiet = step(now) ? 0 : quiet + 1
    if (quiet >= QUIET) { cancelAnimationFrame(id); id = 0 }
  }
  const start = () => {
    quiet = 0
    if (!id && !paused) id = requestAnimationFrame(tick)
  }
  wakers.add(start)
  start()
  return () => {
    wakers.delete(start)
    cancelAnimationFrame(id)
    id = 0
  }
}
