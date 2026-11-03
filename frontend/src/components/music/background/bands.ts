import type { Params } from './settings'

// SPEC-music-player §5.8.2: analyser bins to band levels, with per-band auto-gain.

/** Per-frame step for a time constant, so attack and release do not depend on the frame rate. */
export const tc = (dt: number, ms: number) => 1 - Math.exp((-dt * 1000) / Math.max(1, ms))

export class Bands {
  /** Band levels, 0..1.5. */
  SE = new Float32Array(64)
  private SP = new Float32Array(64)
  private SF = new Float32Array(64).fill(255)

  reset() {
    this.SE.fill(0)
    this.SP.fill(0)
    this.SF.fill(255)
  }

  /** `fq` is getByteFrequencyData output (0..255); null decays the levels (paused). */
  update(fq: Uint8Array | null, sampleRate: number, dt: number, p: Params) {
    const { SE, SP, SF } = this
    const nb = p.nb
    if (!fq) {
      for (let i = 0; i < nb; i++) SE[i] *= 1 - tc(dt, p.rel)
      return
    }
    const N = fq.length
    for (let i = 0; i < nb; i++) {
      const f0 = p.lo * Math.pow(p.hi / p.lo, i / nb)
      const f1 = p.lo * Math.pow(p.hi / p.lo, (i + 1) / nb)
      const b0 = Math.floor((f0 / (sampleRate / 2)) * N)
      const b1 = Math.max(b0 + 1, Math.ceil((f1 / (sampleRate / 2)) * N))
      let a = 0
      for (let b = b0; b < b1; b++) a += fq[b]
      a /= b1 - b0
      // Each band reads between its own slow floor and slow peak, so loud masters still move.
      SP[i] = Math.max(a, SP[i] - p.pk * dt)
      SF[i] = Math.min(a, SF[i] + p.fl * dt)
      let v = Math.max(0, Math.min(1, (a - SF[i]) / Math.max(p.rng, SP[i] - SF[i])))
      v = v * v * (3 - 2 * v)
      const ab = Math.max(0, Math.min(1, (a - 110) / 120))
      v = v * (1 - p.lw) + v * ab * p.lw * 1.6
      v = Math.min(1.5, Math.pow(v, p.crv) * p.gain * Math.max(0, 1 + p.tilt * ((2 * i) / (nb - 1) - 1)))
      SE[i] += (v - SE[i]) * tc(dt, v > SE[i] ? p.att : p.rel)
    }
  }
}

/** The levels the background paints and the Look panel meter reads. */
export const liveBands = new Bands()
