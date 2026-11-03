/** m:ss */
export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(isFinite(seconds) ? seconds : 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** A tempo as a whole number when within .05 of one, else one decimal. */
export function fmtBpm(bpm: number): string {
  return Math.abs(bpm - Math.round(bpm)) < 0.05 ? String(Math.round(bpm)) : bpm.toFixed(1)
}

/** The timeline palette's lo / mi / hi (SPEC-music-player §5.9, Reef). */
export const REEF = ['oklch(44% .11 215)', 'oklch(74% .13 188)', 'oklch(90% .13 155)']

/** The sky behind the player, from the track's hue (§5.2). */
export const sky = (h: number) =>
  `linear-gradient(to top, oklch(15% .045 ${h}) 0%, oklch(10.5% .03 ${h}) 45%, oklch(8.5% .02 ${h}) 100%)`

export const DEFAULT_HUE = 215
