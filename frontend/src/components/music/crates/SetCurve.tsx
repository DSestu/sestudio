import type { SetTrack } from './setBuilder'

const H = 64

/** Tempo (dashed) and energy (solid) across the whole set, over its parts, with a marker where the set is playing. */
export default function SetCurve({ groups, now }: { groups: { name?: string; tracks: SetTrack[] }[]; now?: number }) {
  const all = groups.flatMap(g => g.tracks)
  const total = all.reduce((s, t) => s + t.duration, 0)
  const bpms = all.map(t => t.bpm).filter((b): b is number => !!b)
  if (!total || all.length < 2) return null
  const lo = Math.min(...bpms)
  const hi = Math.max(...bpms)
  const yBpm = (b: number) => (hi === lo ? H / 2 : H - 6 - ((b - lo) / (hi - lo)) * (H - 12))
  const yEn = (e: number) => H - 4 - (e / 100) * (H - 8)

  let at = 0
  const tempo: string[] = []
  const energy: string[] = []
  const bands = groups.map(g => {
    const from = at
    for (const t of g.tracks) {
      const x0 = (at / total) * 100
      const x1 = ((at + t.duration) / total) * 100
      if (t.bpm) tempo.push(`${tempo.length ? 'L' : 'M'}${x0},${yBpm(t.bpm)} L${x1},${yBpm(t.bpm)}`)
      const c = t.curve
      if (c?.length) c.forEach((e, i) => energy.push(`${energy.length ? 'L' : 'M'}${x0 + ((i + 0.5) / c.length) * (x1 - x0)},${yEn(e)}`))
      at += t.duration
    }
    return { name: g.name, left: (from / total) * 100, width: ((at - from) / total) * 100 }
  })

  return (
    <div className="relative h-20 overflow-hidden rounded-xl bg-white/4" role="img" aria-label="Tempo and energy across the set">
      {groups.length > 1 && bands.map((b, i) => (
        <div key={i} className={`absolute inset-y-0 ${i % 2 ? 'bg-white/4' : ''}`} style={{ left: `${b.left}%`, width: `${b.width}%` }}>
          <span className="absolute left-2 top-1 max-w-full truncate pr-2 text-[10px] uppercase tracking-wide text-base-content/50">{b.name}</span>
        </div>
      ))}
      <svg className="absolute inset-x-0 bottom-0 h-16 w-full" viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={tempo.join(' ')} fill="none" stroke="currentColor" strokeOpacity=".55" strokeDasharray="3 3" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <path d={energy.join(' ')} fill="none" className="stroke-primary" strokeWidth="1.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {now !== undefined && <div className="absolute inset-y-0 w-0.5 bg-white/80" style={{ left: `${Math.min(now / total, 1) * 100}%` }} />}
      <div className="absolute bottom-1 right-2 flex gap-3 text-[10px] text-base-content/50">
        <span>- - tempo{bpms.length ? ` ${Math.round(lo)}–${Math.round(hi)}` : ''}</span><span className="text-primary">— energy</span>
      </div>
    </div>
  )
}
