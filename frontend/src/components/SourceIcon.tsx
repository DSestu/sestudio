import { sourceIcon } from '../sourceLook'

// Logos drawn in dark ink, which vanish on the dark theme: flipped to light.
const DARK_INK = new Set(['kisskh'])

/** A source's favicon, straight on the page; its first letter when it has none. */
export default function SourceIcon({ id, label, className }: { id: string; label: string; className: string }) {
  const src = sourceIcon(id)
  return src ? (
    <img src={src} alt="" className={`${className} shrink-0 object-contain ${DARK_INK.has(id) ? 'invert hue-rotate-180' : ''}`} />
  ) : (
    <span className={`${className} shrink-0 rounded-md bg-primary/15 text-primary flex items-center justify-center text-[10px] font-extrabold`} aria-hidden="true">
      {label.slice(0, 1)}
    </span>
  )
}
