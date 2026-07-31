import { useEffect, useRef } from 'react'

// Make the Android/browser back button close the top-most open modal instead of
// navigating away. Each open modal pushes a history entry; a single popstate
// listener pops the LIFO stack and closes one modal per back press. When the
// stack is empty, back navigates normally (leaves the page).

type Entry = { close: () => void }

const stack: Entry[] = []
let ignoreNextPop = 0
let attached = false

function handlePop() {
  if (ignoreNextPop > 0) {
    ignoreNextPop -= 1
    return
  }
  const top = stack.pop()
  if (top) top.close()
}

function attach() {
  if (!attached) {
    window.addEventListener('popstate', handlePop)
    attached = true
  }
}

function pushEntry(close: () => void): () => void {
  attach()
  const entry: Entry = { close }
  stack.push(entry)
  window.history.pushState({ __modal: true }, '')
  return () => {
    const idx = stack.lastIndexOf(entry)
    if (idx === -1) return // already removed by a back press
    stack.splice(idx, 1)
    // The modal closed by other means (✕ / backdrop); consume the history entry
    // we added, ignoring the popstate it triggers so no other modal is closed.
    ignoreNextPop += 1
    window.history.back()
  }
}

/**
 * While `open`, register this modal on the back-button stack. Pressing back
 * calls `onClose` for the top-most modal rather than navigating.
 */
export function useModalBack(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  useEffect(() => {
    if (!open) return
    return pushEntry(() => onCloseRef.current())
  }, [open])
}
