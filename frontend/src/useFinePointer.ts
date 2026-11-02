import { useSyncExternalStore } from 'react'

const QUERY = '(hover: hover) and (pointer: fine)'

/** True where hovering works (a mouse or a trackpad); false on touch screens. */
export function useFinePointer(): boolean {
  return useSyncExternalStore(
    cb => {
      const m = matchMedia(QUERY)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => matchMedia(QUERY).matches,
    () => true,
  )
}
