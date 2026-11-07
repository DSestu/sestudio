import { cost, join, type Join, type ProxTrack } from '../crates/proximity'
import { isClash, type SetTrack } from '../crates/setBuilder'

// Where it fits (SPEC-playlist-edit): the gaps of a playlist ranked for one track.

export interface Spot {
  /** Flat index the track would land at. */
  gap: number
  in?: Join
  out?: Join
  /** It replaces a clash with two safe joins. */
  fixes: boolean
}

const song = (t: { title?: string; artist?: string }) => `${t.title ?? ''}|${t.artist ?? ''}`.toLowerCase()

/** The best gaps for `x` in the playlist: the joins in and out, a clash replaced, the energy against the neighbours. */
export function spotsFor(flat: SetTrack[], x: ProxTrack, titleOf: (i: number) => string, xTitle: string, n = 3): Spot[] {
  const mine = song({ title: xTitle })
  const out: (Spot & { score: number })[] = []
  for (let g = 0; g <= flat.length; g++) {
    const a = flat[g - 1]
    const b = flat[g]
    // Never right beside its own copy.
    if ((a && (a.id === x.id || song({ title: titleOf(g - 1) }) === mine)) || (b && (b.id === x.id || song({ title: titleOf(g) }) === mine))) continue
    const ji = a ? join(a, x) : undefined
    const jo = b ? join(x, b) : undefined
    const fixes = !!(a && b && isClash(join(a, b)) && ji?.safe && jo?.safe)
    // An end has one join: count its missing side as an average one, so the ends don't win by default.
    const score = (ji ? cost(ji) : 4) + (jo ? cost(jo) : 4) - (fixes ? 4 : 0)
    out.push({ gap: g, in: ji, out: jo, fixes, score })
  }
  return out.sort((p, q) => p.score - q.score).slice(0, n)
}
