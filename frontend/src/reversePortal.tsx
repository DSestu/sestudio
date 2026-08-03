import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PortalNode } from './portalNode'

// A minimal "reverse portal": render a subtree into one persistent, detached
// DOM node (InPortal), then physically relocate that node between mount points
// (OutPortal). Because the node itself is never recreated, a <video> inside it
// keeps playing when it moves — e.g. from the watch view into the mini-player
// (issue #20). This is the manual equivalent of react-reverse-portal, kept in
// the repo to avoid a runtime dependency. The host node lives in portalNode.ts.

/** Renders children into the detached host node — mount this wherever the
 *  content's React owner lives; it stays alive regardless of where the node
 *  is currently shown. */
export function InPortal({ node, children }: { node: PortalNode; children: ReactNode }) {
  return createPortal(children, node)
}

/** Shows the host node here by appending it into this element. Exactly one
 *  OutPortal should be mounted at a time; mounting a new one relocates the
 *  node (and its live media) without a remount. When `morph` is set the
 *  container carries the shared view-transition-name so the player animates
 *  between its two spots (#20). */
export function OutPortal({ node, morph = false }: { node: PortalNode; morph?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const container = ref.current
    if (!container) return
    container.appendChild(node)
    return () => {
      if (node.parentNode === container) container.removeChild(node)
    }
  }, [node])
  return <div ref={ref} className={`w-full h-full${morph ? ' vt-player' : ''}`} />
}
