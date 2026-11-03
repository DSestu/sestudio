import type { Plan } from '../timeline/sampling'

export interface Lock {
  /** Seconds to move the incoming element by (0 unless it is more than a quarter beat off). */
  jump: number
  /** The incoming element's playbackRate. */
  rate: number
  /** Phase error in ms, positive when the incoming track is ahead. */
  errMs: number
  locked: boolean
}

/** One step of the phase lock (§9.3): beats since the incoming downbeat must equal the outgoing's since the mix point. */
export function lockPhase(incT: number, outT: number, p: Plan): Lock {
  const beatA = 60 / p.bpmA!
  const beatB = 60 / p.bpmB!
  let e = (incT - p.startOff) / beatB - (outT - p.mixOut) / beatA
  e -= Math.round(e)
  const errMs = e * beatA * 1000
  if (Math.abs(e) > 0.25) return { jump: -e * beatB, rate: p.rate, errMs, locked: false }
  return { jump: 0, rate: p.rate * (1 - Math.max(-0.03, Math.min(0.03, e * 0.3))), errMs, locked: Math.abs(errMs) < 12 }
}
