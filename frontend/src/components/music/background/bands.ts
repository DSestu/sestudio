import type { Params } from './settings'

// SPEC-music-player §5.8.2 and §5.8.7: analyser bins to band levels, with per-band auto-gain and an auto level.

/** Per-frame step for a time constant, so attack and release do not depend on the frame rate. */
export const tc = (dt: number, ms: number) => 1 - Math.exp((-dt * 1000) / Math.max(1, ms))

const mel = (f: number) => 2595 * Math.log10(1 + f / 700)
const imel = (m: number) => 700 * (10 ** (m / 2595) - 1)

/** Band edge u (0..1) in Hz: logarithmic, mel, or a geometric blend of the two (`warp`). */
export function edge(u: number, p: Pick<Params, 'lo' | 'hi' | 'warp'>) {
  const fl = p.lo * (p.hi / p.lo) ** u
  if (!p.warp) return fl
  const fm = imel(mel(p.lo) + u * (mel(p.hi) - mel(p.lo)))
  return fl ** (1 - p.warp) * fm ** p.warp
}

/** Linear up to the knee, then eases towards 1 instead of clipping flat. */
export const softCeil = (v: number, k: number) => (v <= k ? v : k + (1 - k) * Math.tanh((v - k) / (1 - k)))

export class Bands {
  /** Band levels, 0..1.5. */
  SE = new Float32Array(64)
  private SP = new Float32Array(64)
  private SF = new Float32Array(64).fill(255)
  private V = new Float32Array(64)
  /** The auto level's running 85th percentile, null until the first frame. */
  private L: number | null = null

  reset() {
    this.SE.fill(0)
    this.SP.fill(0)
    this.SF.fill(255)
    this.L = null
  }

  /** `fq` is getByteFrequencyData output (0..255); null decays the levels (paused). */
  update(fq: Uint8Array | null, sampleRate: number, dt: number, p: Params) {
    const { SE, SP, SF, V } = this
    const nb = p.nb
    if (!fq) {
      for (let i = 0; i < nb; i++) SE[i] *= 1 - tc(dt, p.rel)
      return
    }
    const N = fq.length
    for (let i = 0; i < nb; i++) {
      const f0 = edge(i / nb, p)
      const f1 = edge((i + 1) / nb, p)
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
      const ab = Math.max(0, Math.min(1, (a - p.abLo) / Math.max(1, p.abHi - p.abLo)))
      v = v * (1 - p.lw) + v * ab * p.lw * 1.6
      V[i] = Math.pow(v, p.crv) * p.gain * Math.max(0, 1 + p.tilt * ((2 * i) / (nb - 1) - 1))
    }
    // Auto level: when the bands' 85th percentile, followed over a few seconds, runs above the target, bring it down.
    // It never raises a quiet passage, so the contrast between sections stays.
    let scale = 1
    if (p.agc) {
      const p85 = Array.from(V.subarray(0, nb)).sort((x, y) => x - y)[Math.floor(nb * 0.85)]
      this.L ??= Math.max(0.05, p85)
      this.L += (p85 - this.L) * tc(dt, (p85 > this.L ? 0.25 : 1) * p.agcSp * 1000)
      scale = 1 - p.agc * (1 - Math.min(1, p.agcT / Math.max(0.05, this.L)))
    }
    for (let i = 0; i < nb; i++) {
      let v = V[i] * scale
      // The gate before the ceiling, so its expansion can still reach the top.
      if (p.gate) v = Math.max(0, (v - p.gate) / (1 - p.gate))
      v = p.agc ? Math.min(1, softCeil(v, p.knee) * 1.08) : Math.min(1.5, v)
      SE[i] += (v - SE[i]) * tc(dt, v > SE[i] ? p.att : p.rel)
    }
  }
}

/** The levels the background paints and the Look panel meter reads. */
export const liveBands = new Bands()
