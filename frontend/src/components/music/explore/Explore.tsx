import { useEffect, useMemo, useRef, useState } from 'react'
import { MOOD_LADDER } from '../../../harmony'
import type { MusicTrack } from '../../../musicLibrary'
import { genreColor, type Summary } from '../../../musicMeta'
import Seg from '../crates/build/Seg'
import { dotOf, PAD, place, ringRadius, type Dot } from './place'

const NOTES = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'A♭', 'E♭', 'B♭', 'F']
const moodColor = (b: number) => MOOD_LADDER.find(m => m.brightness === b)?.color ?? 'currentColor'

/** The width of an element, kept up to date. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.round(el.clientWidth)))
    ro.observe(el)
    setW(Math.round(el.clientWidth))
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

const label = 'fill-base-content/50 text-[11px]'

/** Music › Explore: the tracks as dots, by mood and energy (Vibe) or by note set (Notes). Static SVG, drawn at the pixel size of its box. */
export default function Explore({ tracks, get, v }: { tracks: MusicTrack[]; get: (id: string) => Summary | undefined; v: number }) {
  const [view, setView] = useState<'vibe' | 'notes'>('vibe')
  const [box, w] = useWidth()
  const h = Math.round(w < 520 ? w * 1.1 : w * 0.78)
  const dots = useMemo(() => {
    const out: (Dot & { title: string })[] = []
    for (const t of tracks) {
      const d = dotOf(t.id, get(t.id))
      if (d && (view === 'vibe' || d.set !== undefined)) out.push({ ...d, title: t.title })
    }
    return out
  }, [tracks, view, v]) // eslint-disable-line react-hooks/exhaustive-deps
  const R = ringRadius(w, h)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Seg label="Map" options={[['vibe', 'Vibe'], ['notes', 'Notes']]} value={view} onPick={setView} />
        <span className="text-xs text-base-content/60">{dots.length} of {tracks.length} tracks placed</span>
      </div>
      <div ref={box} className="w-full">
        {w > 0 && (
          <svg width={w} height={h} role="img" aria-label={view === 'vibe' ? 'Tracks by mood, dark to bright, and energy, calm to intense' : 'Tracks by note set on the circle of fifths'} className="rounded-2xl bg-white/3">
            {view === 'vibe' ? (
              <>
                <text x={PAD} y={h - 6} className={label}>Unstable · dark</text>
                <text x={w - PAD} y={h - 6} textAnchor="end" className={label}>bright · Floating</text>
                <text x={8} y={16} className={label}>Intense ↑</text>
                <text x={8} y={h - 26} className={label}>Calm</text>
                <line x1={w / 2} x2={w / 2} y1={24} y2={h - 24} stroke="currentColor" strokeOpacity={0.06} />
                <line x1={PAD} x2={w - PAD} y1={h / 2} y2={h / 2} stroke="currentColor" strokeOpacity={0.06} />
                <text x={PAD + 4} y={34} className={label}>Dark &amp; intense</text>
                <text x={w - PAD - 4} y={34} textAnchor="end" className={label}>Bright &amp; intense</text>
                <text x={PAD + 4} y={h - 38} className={label}>Dark &amp; calm</text>
                <text x={w - PAD - 4} y={h - 38} textAnchor="end" className={label}>Bright &amp; calm</text>
              </>
            ) : (
              <>
                {NOTES.map((n, k) => {
                  const a = (k / 12) * Math.PI * 2 - Math.PI / 2
                  return (
                    <g key={n}>
                      <line x1={w / 2} y1={h / 2} x2={w / 2 + Math.cos(a) * R} y2={h / 2 + Math.sin(a) * R} stroke="currentColor" strokeOpacity={0.06} />
                      <text x={w / 2 + Math.cos(a) * (R + 14)} y={h / 2 + Math.sin(a) * (R + 14) + 4} textAnchor="middle" className={label}>{n}</text>
                    </g>
                  )
                })}
                <circle cx={w / 2} cy={h / 2} r={R * 0.32} fill="none" stroke="currentColor" strokeOpacity={0.08} />
                <circle cx={w / 2} cy={h / 2} r={R * 0.94} fill="none" stroke="currentColor" strokeOpacity={0.08} />
                <text x={w / 2} y={h / 2 + 4} textAnchor="middle" className={label}>dark</text>
              </>
            )}
            {dots.map(d => {
              const [x, y] = place(d, view, w, h)
              return (
                <circle key={d.id} cx={x} cy={y} r={view === 'vibe' && w < 520 ? 4.5 : 6} fill={view === 'vibe' && d.genre ? genreColor(d.genre) : view === 'vibe' ? 'oklch(75% .02 265)' : moodColor(d.brightness)} fillOpacity={0.85}>
                  <title>{d.title}</title>
                </circle>
              )
            })}
          </svg>
        )}
      </div>
      {view === 'notes' && <p className="text-xs text-base-content/60">Neighbours on the circle share 6 of 7 notes. The nearer the centre, the darker the mood.</p>}
    </div>
  )
}
