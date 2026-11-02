import { useEffect, useSyncExternalStore } from 'react'

// Whether a now-playing strip (the cast bar or the mini-player) is showing on
// the phone. The dock and the Discover menu square off the corners it sits on,
// so the phone's bottom chrome reads as one rounded object.

let mounted = 0
const listeners = new Set<() => void>()

function change(delta: 1 | -1) {
  mounted += delta
  listeners.forEach(l => l())
}

/** Count a strip as showing while *active*. */
export function usePhoneStrip(active: boolean) {
  useEffect(() => {
    if (!active) return
    change(1)
    return () => change(-1)
  }, [active])
}

export function usePhoneStripShown(): boolean {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => listeners.delete(l) },
    () => mounted > 0,
  )
}
