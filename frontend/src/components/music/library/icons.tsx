// The explorer's small icons: one path each, drawn in the current colour.
const PATHS = {
  right: 'M9 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  up: 'M12 19V5M5 12l7-7 7 7',
  album: 'M4 4h16v16H4zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  user: 'M20 21a8 8 0 0 0-16 0M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  disk: 'M3 7h18v10H3zM7 13h.01M11 13h.01',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  mood: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 4a8 8 0 0 1 0 16',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01',
  tempo: 'M9 3h6l3 18H6zM12 16l5-9',
  bars: 'M5 20v-4M10 20v-8M15 20V8M20 20V4',
  key: 'M8 11a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM11 12l9-9M17 6l3 3M15 8l2 2',
  az: 'M3 18l4-12 4 12M4.5 14h5M14 6h6l-6 12h6',
  list: 'M4 6h16M4 12h16M4 18h16',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  sort: 'M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3',
  flow: 'M3 17c3 0 4-10 7-10s4 6 7 6 3-3 4-3',
  search: 'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM20 20l-5.5-5.5',
  pin: 'M12 16v6M8 3h8l-1.5 6L18 13H6l3.5-4z',
} as const
export type IconName = keyof typeof PATHS

export function Ic({ name, size = 14, className = '', width = 1.8 }: { name: IconName; size?: number; className?: string; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
