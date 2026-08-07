import type { ReactNode } from 'react'

// Icons for the standard library actions, so callers don't each redraw them.
// A separate module from the components that use them, because component
// files may only export
// components (fast-refresh rule).

function pathIcon(d: string): ReactNode {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}

export const sheetIcon = {
  watchlist: pathIcon('M11.48 3.5a.56.56 0 011.04 0l2.12 4.3 4.75.69c.46.07.64.63.31.95l-3.44 3.35.81 4.73c.08.46-.4.81-.81.59L12 15.87l-4.26 2.24c-.41.22-.89-.13-.81-.59l.81-4.73-3.44-3.35a.56.56 0 01.31-.95l4.75-.69 2.12-4.3z'),
  favourite: pathIcon('M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z'),
  watched: pathIcon('M5 13l4 4L19 7'),
  remove: pathIcon('M6 18L18 6M6 6l12 12'),
  open: pathIcon('M13 5h6v6M19 5l-7 7M10 5H5v14h14v-5'),
}
