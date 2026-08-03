// The persistent, detached DOM node that hosts a relocatable subtree for the
// reverse portal (see reversePortal.tsx). Kept in its own module so the
// component file only exports components (fast-refresh friendly).

export type PortalNode = HTMLDivElement

/** Create the host node once (e.g. via a useState initializer). */
export function createPortalNode(): PortalNode {
  const node = document.createElement('div')
  node.style.width = '100%'
  node.style.height = '100%'
  return node
}
