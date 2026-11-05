import { genreColor } from '../../../musicMeta'
import { join } from './proximity'
import { isClash, type SetTrack } from './setBuilder'

const H = 96
/** Energy on the library scale, then mood (brightness +3 .. -3), then the genre ribbon. */
const yEn = (e: number) => 6 + (1 - e / 100) * 44
const yMood = (b: number) => 56 + ((3 - b) / 6) * 20
const MOOD_COLOR = 'oklch(78% .13 330)'

/** Energy (solid), mood (dashed) and genre (ribbon) track by track across the whole set, over its parts,
 *  with amber ticks where a join clashes or the tempo jumps and a marker where the set is playing. */
export default function SetCurve({ groups, now }: { groups: { name?: string; tracks: SetTrack[] }[]; now?: number }) {
  const all = groups.flatMap(g => g.tracks)
  const total = all.reduce((s, t) => s + t.duration, 0)
  if (!total || all.length < 2) return null

  let at = 0
  let k = 0
  const energy: string[] = []
  const mood: string[] = []
  const ribbon: { x: number; w: number; color: string }[] = []
  const ticks: number[] = []
  const bands = groups.map(g => {
    const from = at
    for (const t of g.tracks) {
      const x0 = (at / total) * 100
      const w = (t.duration / total) * 100
      const xm = x0 + w / 2
      const e = t.energyScale?.track
      const b = t.harmony?.track?.brightness
      if (e != null) energy.push(`${energy.length ? 'L' : 'M'}${xm},${yEn(e)}`)
      if (b != null) mood.push(`${mood.length ? 'L' : 'M'}${xm},${yMood(b)}`)
      ribbon.push({ x: x0, w, color: t.genre ? genreColor(t.genre) : 'transparent' })
      if (k++) {
        const j = join(all[k - 2], t)
        if (isClash(j) || j.tempoJump) ticks.push(x0)
      }
      at += t.duration
    }
    return { name: g.name, left: (from / total) * 100, width: ((at - from) / total) * 100 }
  })

  return (
    <div className="relative h-24 overflow-hidden rounded-xl bg-white/4" role="img" aria-label="Energy, mood and genre across the set">
      {groups.length > 1 && bands.map((b, i) => (
        <div key={i} className={`absolute inset-y-0 ${i % 2 ? 'bg-white/4' : ''}`} style={{ left: `${b.left}%`, width: `${b.width}%` }}>
          <span className="absolute left-2 top-1 max-w-full truncate pr-2 text-[10px] uppercase tracking-wide text-base-content/50">{b.name}</span>
        </div>
      ))}
      <svg className="absolute inset-0 size-full" viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {ticks.map(x => <line key={x} x1={x} x2={x} y1="2" y2="80" className="stroke-warning" strokeDasharray="2 3" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />)}
        <path d={energy.join(' ')} fill="none" className="stroke-base-content" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <path d={mood.join(' ')} fill="none" stroke={MOOD_COLOR} strokeWidth="1.6" strokeDasharray="4 3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {ribbon.map((r, i) => <rect key={i} x={r.x + 0.1} y="84" width={Math.max(r.w - 0.2, 0.1)} height="9" fill={r.color} opacity=".6" />)}
      </svg>
      {now !== undefined && <div className="absolute inset-y-0 w-0.5 bg-white/80" style={{ left: `${Math.min(now / total, 1) * 100}%` }} />}
      <div className="absolute right-2 top-1 flex gap-3 text-[10px] text-base-content/50">
        <span>— energy</span><span style={{ color: MOOD_COLOR }}>- - mood</span><span>▬ genre</span>
      </div>
    </div>
  )
}
