import { useEffect, useState } from 'react'
import { useTvVolume } from '../../musicQueue'

/** The TV page's volume pill, top-centre for 1.6 s after each change. */
export default function VolumePill() {
  const { volume, changes } = useTvVolume()
  // The change number the pill has finished showing.
  const [done, setDone] = useState(0)
  useEffect(() => {
    if (!changes) return
    const t = setTimeout(() => setDone(changes), 1600)
    return () => clearTimeout(t)
  }, [changes])
  if (!changes || done === changes || !volume) return null
  const pct = volume.muted ? 0 : Math.round(volume.level * 100)
  return (
    <div className="absolute top-8 left-1/2 -translate-x-1/2 z-20 flex items-center gap-4 rounded-full glass px-7 py-3.5 text-2xl font-medium tabular-nums">
      <svg className="size-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 5L6 9H3v6h3l5 4z" />
        {pct === 0 ? <path d="M16 9l5 6m0-6l-5 6" /> : <path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" />}
      </svg>
      <span className="relative h-1.5 w-48 rounded-full bg-white/20 overflow-hidden"><span className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${pct}%` }} /></span>
      <span className="w-12 text-right">{pct}</span>
    </div>
  )
}
