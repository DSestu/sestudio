import type { SetTrack } from './setBuilder'

// The playlist timeline's runs (SetCurve.tsx): back-to-back tracks sharing a genre or a key colour.

/** A track's key colour, as flows.py colour(): bright, warm, dark, exotic; undefined while unread. */
export const colourOf = (t: SetTrack): string | undefined => {
  const r = t.harmony?.track
  if (!r) return undefined
  const b = r.brightness
  return b == null ? 'exotic' : b >= 2 ? 'bright' : b >= 0 ? 'warm' : 'dark'
}

/** Runs of back-to-back tracks sharing a value; `cut` starts a new run at a track even when it matches. */
export function runsOf(tracks: SetTrack[], key: (t: SetTrack) => string | undefined, cut: (i: number) => boolean = () => false) {
  const out: { v?: string; from: number; to: number; s: number; d: number; cut: boolean }[] = []
  let at = 0
  tracks.forEach((t, i) => {
    const v = key(t), last = out.at(-1)
    if (last && last.v === v && !cut(i)) { last.to = i + 1; last.d += t.duration }
    else out.push({ v, from: i, to: i + 1, s: at, d: t.duration, cut: i > 0 && cut(i) })
    at += t.duration
  })
  return out
}
