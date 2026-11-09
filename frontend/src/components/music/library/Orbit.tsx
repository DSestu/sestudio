import { useMemo } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import type { Facts } from './facts'
import { MOOD_ORDER } from './facts'
import { FITS_RING, fitDist, RINGS } from './fit'
import { Ic } from './icons'
import { silhouette, trackColor, type Colour } from './sigil'

// The orbit (SPEC-music-library §2.5): the focused track at the centre, every other track placed
// by mood (angle, in ladder order) and fit distance (radius); set members outlined. Click a dot
// to focus it. Under it, "Fits after it": the 5 closest, each with +.

const W = 330, R0 = 34, R = W / 2 - 10
const jit = (id: string) => (parseInt(id.slice(0, 6), 16) % 1000) / 1000 || 0.5

export default function Orbit({ focus, all, facts, colour, inSet, onFocus, onAdd }: {
  focus: MusicTrack
  all: MusicTrack[]
  facts: Facts
  colour: Colour
  inSet: ReadonlySet<string>
  onFocus: (t: MusicTrack) => void
  onAdd: (t: MusicTrack) => void
}) {
  const p = facts(focus.id)
  const placed = useMemo(() => all.filter(t => t.id !== focus.id).map(t => {
    const f = facts(t.id)
    const d = fitDist(f, p)
    const i = Math.max(0, MOOD_ORDER.indexOf(f.mood?.word ?? ''))
    const a = ((i + 0.1 + jit(t.id) * 0.8) / MOOD_ORDER.length) * Math.PI * 2 - Math.PI / 2
    const rr = R0 + d * (R - R0)
    return { t, f, d, x: W / 2 + Math.cos(a) * rr, y: W / 2 + Math.sin(a) * rr }
  }), [all, facts, focus.id, p])
  const near = useMemo(() => [...placed].sort((a, b) => a.d - b.d).slice(0, 5), [placed])
  const fitsN = placed.filter(x => x.d < FITS_RING).length
  return (
    <section className="flex flex-col gap-2 p-3">
      <div className="relative overflow-hidden rounded-2xl" style={{ background: 'radial-gradient(60% 60% at 50% 50%, oklch(21% .035 250), oklch(15% .02 245) 85%)' }}>
        <span className="absolute inset-x-3 top-2.5 truncate text-[11px] text-base-content/40">Around {focus.title} · click a dot to move there</span>
        <svg viewBox={`0 0 ${W} ${W}`} className="block w-full" aria-label="Tracks around the focused one">
          {RINGS.map(([f, label], k) => (
            <g key={label}>
              <circle cx={W / 2} cy={W / 2} r={R0 + f * (R - R0)} fill="none" stroke={`oklch(60% .03 240 / ${k ? 0.16 : 0.5})`} strokeDasharray={k ? '2 5' : undefined} />
              <text x={W / 2 + 4} y={W / 2 - (R0 + f * (R - R0)) + 10} fontSize="9" fill="oklch(70% .02 240 / .5)">{label}</text>
            </g>
          ))}
          {placed.map(({ t, f, d, x, y }) => (
            <circle key={t.id} cx={x.toFixed(1)} cy={y.toFixed(1)} r={d < FITS_RING ? 3.6 : 2.4} fill={trackColor(f, colour)} fillOpacity={d < FITS_RING ? 0.95 : 0.35}
              stroke={inSet.has(t.id) ? 'oklch(72% .16 230)' : undefined} strokeWidth={inSet.has(t.id) ? 1.5 : undefined}
              className="cursor-pointer hover:stroke-base-content hover:stroke-2" onClick={() => onFocus(t)}>
              <title>{t.title}</title>
            </circle>
          ))}
          <g transform={`translate(${W / 2 - 22},${W / 2 - 14})`}>
            <rect width="44" height="28" rx="7" fill={trackColor(p, colour)} fillOpacity=".12" />
            <path d={silhouette(p.curve, 4, 36, 22, 14)} fill={trackColor(p, colour)} />
          </g>
        </svg>
      </div>
      <h4 className="flex items-baseline gap-1.5 text-[13px] font-semibold">Fits after it <small className="font-normal text-base-content/50">{fitsN} tracks</small></h4>
      <ul className="flex flex-col">
        {near.map(({ t, f, d }) => (
          <li key={t.id} className="flex h-11 items-center gap-2.5 rounded-xl px-1.5 hover:bg-white/5">
            <button onClick={() => onFocus(t)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
              <svg width="48" height="32" viewBox="0 0 48 32" className="shrink-0" aria-hidden="true">
                <rect width="48" height="32" rx="8" fill={trackColor(f, colour)} fillOpacity=".08" />
                <path d={silhouette(f.curve, 4, 40, 26, 16)} fill={trackColor(f, colour)} />
              </svg>
              <span className="min-w-0 leading-tight">
                <b className="block truncate text-[13px] font-medium">{t.title}</b>
                <small className="block truncate text-[11px] text-base-content/50">{[f.mood?.word, f.bpm && Math.round(f.bpm), `${Math.round((1 - d) * 100)}%`].filter(Boolean).join(' · ')}</small>
              </span>
            </button>
            <button onClick={() => onAdd(t)} aria-label={`Add ${t.title}`} className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/8 text-base-content/70 hover:text-primary"><Ic name={inSet.has(t.id) ? 'close' : 'plus'} size={14} width={2.2} /></button>
          </li>
        ))}
      </ul>
    </section>
  )
}
