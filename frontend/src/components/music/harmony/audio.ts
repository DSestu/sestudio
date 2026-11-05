let ctx: AudioContext | undefined

/** Semitones above C4 of a scale played up from its home note and back to the octave. */
export function scaleSemitones(notes: readonly number[], home: number): number[] {
  const up = notes.map(n => (n - home + 12) % 12).sort((a, b) => a - b)
  return [...up, 12].map(iv => home + iv)
}

interface Voice {
  wave?: OscillatorType
  /** Seconds between notes. */
  step?: number
  /** Seconds each note rings. */
  dur?: number
  /** Seconds before the first note. */
  at?: number
  gain?: number
}

/** Plays notes (semitones above C4) one after the other; returns when the last one ends, in seconds from now. */
export function playSemitones(semis: number[], { wave = 'triangle', step = 0.2, dur = 0.4, at = 0, gain = 0.15 }: Voice = {}): number {
  ctx ??= new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  if (ctx.state === 'suspended') void ctx.resume()
  const t0 = ctx.currentTime + 0.05 + at
  semis.forEach((s, i) => {
    const o = ctx!.createOscillator()
    const g = ctx!.createGain()
    const t = t0 + i * step
    o.type = wave
    o.frequency.value = 261.63 * Math.pow(2, s / 12)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gain, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    o.connect(g).connect(ctx!.destination)
    o.start(t)
    o.stop(t + dur + 0.02)
  })
  return at + semis.length * step + dur
}

export const playScale = (notes: readonly number[], home: number, at = 0) => playSemitones(scaleSemitones(notes, home), { at })

/** A scale, a beat, then another: the change a join makes. */
export function playChange(a: readonly number[], homeA: number, b: readonly number[], homeB: number) {
  playScale(b, homeB, playScale(a, homeA) + 0.3)
}
