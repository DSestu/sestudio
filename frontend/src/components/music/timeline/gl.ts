// The timeline in WebGL2, made cheap for the software renderer the TV station runs on (SwiftShader):
// no multisampling and no full-screen copies. Shapes are triangles that work out their own edge
// coverage (anti-aliasing), and the curves are one pass over their band that reads each device-pixel
// column's curve heights from a texture.

/** RGBA, premultiplied, 0..1. */
export type RGBA = [number, number, number, number]
export type Blend = 'over' | 'erase'

export function program(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
    gl.attachShader(p, s)
  }
  gl.linkProgram(p)
  return p
}

// Shapes: `b` is the shape's box (CSS px), `r` a disc's radius (0: a box; below 0: a diamond of that
// size, centred on b.xy). Coverage of each device pixel by the shape gives the anti-aliased edge.
const SHAPE_VS = `#version 300 es
layout(location = 0) in vec2 p; layout(location = 1) in vec4 c; layout(location = 2) in vec4 b; layout(location = 3) in float r;
uniform vec2 k; uniform float oy; out vec4 vc; flat out vec4 vb; flat out float vr; out vec2 vp;
void main() { vc = c; vb = b; vr = r; vp = p; gl_Position = vec4(p.x * k.x - 1.0, 1.0 - (p.y - oy) * k.y, 0.0, 1.0); }`
const SHAPE_FS = `#version 300 es
precision highp float; in vec4 vc; flat in vec4 vb; flat in float vr; in vec2 vp; uniform float dpr; out vec4 o;
float span(float a, float b, float x) { return clamp(min(b, x + 0.5) - max(a, x - 0.5), 0.0, 1.0); }
void main() {
  vec2 q = vp * dpr;
  float cov;
  if (vr > 0.0) cov = clamp(vr * dpr - length(q - vb.xy * dpr) + 0.5, 0.0, 1.0);
  else if (vr < 0.0) { vec2 d = abs(q - vb.xy * dpr); cov = clamp((-vr * dpr - d.x - d.y) * 0.7071 + 0.5, 0.0, 1.0); }
  else cov = span(vb.x * dpr, vb.z * dpr, q.x) * span(vb.y * dpr, vb.w * dpr, q.y);
  o = vc * cov;
}`

// The curves over their glow, as one group (left of the playhead at 42 %, falling off ahead of it). `h`
// holds, per device column, the device y of the lo, mi and hi curves, and -1 where nothing is drawn or
// else the strength of the rim light behind an analysis front.
const CURVE_VS = `#version 300 es
layout(location = 0) in vec2 p; uniform vec2 k; uniform float oy; out vec2 vp;
void main() { vp = p; gl_Position = vec4(p.x * k.x - 1.0, 1.0 - (p.y - oy) * k.y, 0.0, 1.0); }`
const CURVE_FS = `#version 300 es
precision highp float; in vec2 vp;
uniform highp sampler2D h; uniform sampler2D glow; uniform float dpr; uniform float y0;
uniform vec2 band; uniform float px; uniform float hw; uniform vec2 gscale; uniform float ga;
uniform vec4 lo; uniform vec4 mi; uniform vec4 hi; uniform vec4 edge; uniform vec4 rim; uniform float fall; out vec4 o;
float off(float k) { return 0.38 * (1.0 - exp(-(k / 2.0) * (k / 2.0))); }
float slope(int x, int ch) {
  int w = textureSize(h, 0).x;
  float a = texelFetch(h, ivec2(max(x - 1, 0), 0), 0)[ch], b = texelFetch(h, ivec2(min(x + 1, w - 1), 0), 0)[ch];
  return (b - a) * 0.5;
}
void over(inout vec4 g, vec4 c, float a) { g = c * a + g * (1.0 - c.a * a); }
void main() {
  vec2 q = vp * dpr;
  int x = int(floor(q.x));
  vec4 v = texelFetch(h, ivec2(x, 0), 0);
  // The glow, drawn small and scaled up; a strong one is added twice, each clamped (as the 2D canvas did).
  vec4 G = texture(glow, vp * gscale);
  vec4 g = min(G * min(ga, 1.0), 1.0);
  if (ga > 1.0) g = min(g + G * (ga - 1.0), 1.0);
  if (v.a >= 0.0) {
    float Y = y0 * dpr;
    float rows = clamp(min(band.y * dpr, q.y + 0.5) - max(band.x * dpr, q.y - 0.5), 0.0, 1.0);
    float bot = clamp(q.y - Y + 0.5, 0.0, 1.0), top = clamp(Y - q.y + 0.5, 0.0, 1.0);
    // Below the horizon for the bass, above it for the mids and highs; the curve's edge eased by its slope.
    float sl = slope(x, 0);
    float cl = clamp((v.r - q.y) / sqrt(1.0 + sl * sl) + 0.5, 0.0, 1.0) * bot;
    sl = slope(x, 1);
    float cm = clamp((q.y - v.g) / sqrt(1.0 + sl * sl) + 0.5, 0.0, 1.0) * top;
    float sh = slope(x, 2);
    float n = sqrt(1.0 + sh * sh);
    float chi = clamp((q.y - v.b) / n + 0.5, 0.0, 1.0) * top;
    float ce = clamp(hw * dpr + 0.5 - abs(q.y - v.b) / n, 0.0, 1.0);
    over(g, lo, cl * rows);
    over(g, mi, cm * rows);
    over(g, hi, chi * rows);
    over(g, edge, ce * rows);
    if (v.a > 0.0) {
      // The rim: 1.6 px outlines of the highs, mids and bass.
      float r = v.a * rows;
      over(g, rim, clamp(0.8 * dpr + 0.5 - abs(q.y - v.b) / n, 0.0, 1.0) * r);
      sl = slope(x, 1);
      over(g, rim, clamp(0.8 * dpr + 0.5 - abs(q.y - v.g) / sqrt(1.0 + sl * sl), 0.0, 1.0) * r);
      sl = slope(x, 0);
      over(g, rim, clamp(0.8 * dpr + 0.5 - abs(q.y - v.r) / sqrt(1.0 + sl * sl), 0.0, 1.0) * r);
    }
  }
  // Ahead of the playhead the light falls off: 0 at it, 38 % gone three quarters of the strip on.
  float xc = q.x / dpr;
  if (xc > px - 0.5 / dpr) {
    float u = clamp((xc - px) / (3.0 * fall), 0.0, 1.0) * 6.0;
    float k0 = floor(u);
    float a = mix(off(k0), off(min(k0 + 1.0, 6.0)), u - k0);
    g *= 1.0 - a * clamp((xc - px) * dpr + 0.5, 0.0, 1.0);
  }
  float played = clamp(px * dpr - q.x + 0.5, 0.0, 1.0);
  o = g * mix(1.0, 0.42, played);
}`

const F = 11 // floats per vertex: x, y, r, g, b, a, box x0 y0 x1 y1, radius

/** Growable vertex list. */
export class Tris {
  d = new Float32Array(F * 4096)
  n = 0
  clear() { this.n = 0 }
  private room(k: number) {
    if ((this.n + k) * F <= this.d.length) return
    const b = new Float32Array(Math.max(this.d.length * 2, (this.n + k) * F))
    b.set(this.d)
    this.d = b
  }
  private v(x: number, y: number, c: RGBA, b: readonly number[], r: number) {
    this.room(1)
    const d = this.d, i = this.n++ * F
    d[i] = x; d[i + 1] = y; d[i + 2] = c[0]; d[i + 3] = c[1]; d[i + 4] = c[2]; d[i + 5] = c[3]
    d[i + 6] = b[0]; d[i + 7] = b[1]; d[i + 8] = b[2]; d[i + 9] = b[3]; d[i + 10] = r
  }
  /** An axis-aligned quad, colour per corner (tl, tr, br, bl); `box` is the whole shape it belongs to. */
  private quad(x0: number, y0: number, x1: number, y1: number, tl: RGBA, tr: RGBA, br: RGBA, bl: RGBA, box: readonly number[]) {
    this.v(x0, y0, tl, box, 0); this.v(x1, y0, tr, box, 0); this.v(x1, y1, br, box, 0)
    this.v(x0, y0, tl, box, 0); this.v(x1, y1, br, box, 0); this.v(x0, y1, bl, box, 0)
  }
  rect(x: number, y: number, w: number, h: number, c: RGBA) {
    const e = 1 // one CSS px of fringe for the edge's partial pixels
    this.quad(x - e, y - e, x + w + e, y + h + e, c, c, c, c, [x, y, x + w, y + h])
  }
  /** A rect whose colour runs top to bottom through `stops` ([offset 0..1, colour]). */
  vgrad(x: number, y: number, w: number, h: number, stops: [number, RGBA][]) {
    const box = [x, y, x + w, y + h], e = 1
    for (let i = 0; i < stops.length - 1; i++) {
      const [o0, c0] = stops[i], [o1, c1] = stops[i + 1]
      const ya = i === 0 ? y - e : y + h * o0, yb = i === stops.length - 2 ? y + h + e : y + h * o1
      this.quad(x - e, ya, x + w + e, yb, c0, c0, c1, c1, box)
    }
  }
  /** The same, left to right. */
  hgrad(x: number, y: number, w: number, h: number, stops: [number, RGBA][]) {
    const box = [x, y, x + w, y + h], e = 1
    for (let i = 0; i < stops.length - 1; i++) {
      const [o0, c0] = stops[i], [o1, c1] = stops[i + 1]
      const xa = i === 0 ? x - e : x + w * o0, xb = i === stops.length - 2 ? x + w + e : x + w * o1
      this.quad(xa, y - e, xb, y + h + e, c0, c1, c1, c0, box)
    }
  }
  disc(x: number, y: number, r: number, c: RGBA) {
    const e = r + 1, b = [x, y, 0, 0]
    this.v(x - e, y - e, c, b, r); this.v(x + e, y - e, c, b, r); this.v(x + e, y + e, c, b, r)
    this.v(x - e, y - e, c, b, r); this.v(x + e, y + e, c, b, r); this.v(x - e, y + e, c, b, r)
  }
  /** A square on its point, `r` from the centre to each tip. */
  diamond(x: number, y: number, r: number, c: RGBA) {
    const e = r + 1, b = [x, y, 0, 0]
    this.v(x - e, y - e, c, b, -r); this.v(x + e, y - e, c, b, -r); this.v(x + e, y + e, c, b, -r)
    this.v(x - e, y - e, c, b, -r); this.v(x + e, y + e, c, b, -r); this.v(x - e, y + e, c, b, -r)
  }
}

/** Colours as the 2D canvas renders them (its oklch to sRGB mapping), read back once per colour. */
const probe2d = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })!
const seen = new Map<string, [number, number, number]>()
export function rgb(css: string): [number, number, number] {
  let c = seen.get(css)
  if (!c) {
    probe2d.clearRect(0, 0, 1, 1)
    probe2d.fillStyle = css
    probe2d.fillRect(0, 0, 1, 1)
    const d = probe2d.getImageData(0, 0, 1, 1).data
    c = [d[0] / 255, d[1] / 255, d[2] / 255]
    seen.set(css, c)
  }
  return c
}
export const pm = (c: readonly [number, number, number], a: number): RGBA => [c[0] * a, c[1] * a, c[2] * a, a]

export interface Curves {
  /** Per device column: lo, mi, hi device y (page px × dpr, from the canvas top) and brightness. */
  cols: Float32Array
  /** Rows the curves are cut to, and the rows the group (with its glow) covers, CSS px. */
  by: number
  bh: number
  cy: number
  ch: number
  y0: number
  px: number
  /** Half the edge line's width, CSS px. */
  hw: number
  lo: RGBA
  mi: RGBA
  hi: RGBA
  edge: RGBA
  /** The rim light's colour, and the width over which the light falls off ahead of the playhead (CSS px). */
  rim: RGBA
  fall: number
  /** The glow canvas and its strength; CSS (x, y) times `gscale` is its uv. */
  glow: HTMLCanvasElement
  ga: number
  gscale: [number, number]
}

export class Gl {
  gl: WebGL2RenderingContext
  private shape!: WebGLProgram
  private curve!: WebGLProgram
  private svao!: WebGLVertexArrayObject
  private sbuf!: WebGLBuffer
  private cvao!: WebGLVertexArrayObject
  private cbuf!: WebGLBuffer
  private hTex!: WebGLTexture
  private glowTex!: WebGLTexture
  private hW = 0
  private locs = new Map<string, WebGLUniformLocation | null>()
  /** Device size of the canvas, the CSS width it spans, its density and the CSS y of its top. */
  w = 0
  h = 0
  private W = 0
  private dpr = 1
  oy = 0

  constructor(canvas: HTMLCanvasElement, onRestore: () => void) {
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: true, depth: false, stencil: false })
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl
    this.init()
    // A phone may drop the context (memory, a switch of apps): it is rebuilt when it comes back.
    canvas.addEventListener('webglcontextlost', e => e.preventDefault())
    canvas.addEventListener('webglcontextrestored', () => { this.init(); onRestore() })
  }

  private u(p: WebGLProgram, name: string) {
    const key = (p === this.shape ? 's:' : 'c:') + name
    let l = this.locs.get(key)
    if (l === undefined) this.locs.set(key, (l = this.gl.getUniformLocation(p, name)))
    return l
  }

  private init() {
    const gl = this.gl
    this.locs.clear()
    this.hW = 0
    this.shape = program(gl, SHAPE_VS, SHAPE_FS)
    this.curve = program(gl, CURVE_VS, CURVE_FS)
    this.sbuf = gl.createBuffer()!
    this.svao = gl.createVertexArray()!
    gl.bindVertexArray(this.svao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sbuf)
    const S = F * 4
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, S, 0)
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, S, 8)
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, S, 24)
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, S, 40)
    this.cbuf = gl.createBuffer()!
    this.cvao = gl.createVertexArray()!
    gl.bindVertexArray(this.cvao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cbuf)
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0)
    gl.bindVertexArray(null)
    const tex = (filter: number) => {
      const t = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return t
    }
    this.hTex = tex(gl.NEAREST)
    this.glowTex = tex(gl.LINEAR)
    gl.enable(gl.BLEND)
  }

  /** `w`, `h`: the canvas in device pixels; `W`: the CSS width it spans. */
  size(w: number, h: number, W: number, dpr: number) {
    this.w = w
    this.h = h
    this.W = W
    this.dpr = dpr
  }

  private k(): [number, number] {
    return [2 / this.W, (2 * this.dpr) / this.h]
  }

  /** Clears the canvas and limits drawing to a CSS rect, rounded to whole device pixels. */
  begin(x: number, y: number, w: number, h: number) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.w, this.h)
    gl.disable(gl.SCISSOR_TEST)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const d = this.dpr
    const x0 = Math.max(0, Math.round(x * d)), x1 = Math.min(this.w, Math.round((x + w) * d))
    const y0 = Math.max(0, Math.round((y - this.oy) * d)), y1 = Math.min(this.h, Math.round((y + h - this.oy) * d))
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(x0, this.h - y1, Math.max(0, x1 - x0), Math.max(0, y1 - y0))
  }

  blend(b: Blend) {
    const gl = this.gl
    if (b === 'over') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    else gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA)
  }

  /** Uploads the shapes; `draw` then paints a range of them. */
  load(t: Tris) {
    const gl = this.gl
    gl.useProgram(this.shape)
    const [kx, ky] = this.k()
    gl.uniform2f(this.u(this.shape, 'k'), kx, ky)
    gl.uniform1f(this.u(this.shape, 'oy'), this.oy)
    gl.uniform1f(this.u(this.shape, 'dpr'), this.dpr)
    gl.bindVertexArray(this.svao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sbuf)
    gl.bufferData(gl.ARRAY_BUFFER, t.d.subarray(0, t.n * F), gl.STREAM_DRAW)
  }

  draw(from: number, to: number) {
    if (to > from) this.gl.drawArrays(this.gl.TRIANGLES, from, to - from)
  }

  /** The curves and their glow, over rows cy..cy+ch. */
  curves(c: Curves) {
    const gl = this.gl, p = this.curve
    gl.useProgram(p)
    const [kx, ky] = this.k()
    gl.uniform2f(this.u(p, 'k'), kx, ky)
    gl.uniform1f(this.u(p, 'oy'), this.oy)
    gl.uniform1f(this.u(p, 'dpr'), this.dpr)
    gl.uniform1f(this.u(p, 'y0'), c.y0)
    gl.uniform2f(this.u(p, 'band'), c.by, c.by + c.bh)
    gl.uniform1f(this.u(p, 'px'), c.px)
    gl.uniform1f(this.u(p, 'hw'), c.hw)
    gl.uniform2f(this.u(p, 'gscale'), c.gscale[0], c.gscale[1])
    gl.uniform1f(this.u(p, 'ga'), c.ga)
    gl.uniform4fv(this.u(p, 'lo'), c.lo)
    gl.uniform4fv(this.u(p, 'mi'), c.mi)
    gl.uniform4fv(this.u(p, 'hi'), c.hi)
    gl.uniform4fv(this.u(p, 'edge'), c.edge)
    gl.uniform4fv(this.u(p, 'rim'), c.rim)
    gl.uniform1f(this.u(p, 'fall'), c.fall)
    // The columns, one row of floats.
    const n = c.cols.length / 4
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.hTex)
    if (n !== this.hW) {
      this.hW = n
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, n, 1, 0, gl.RGBA, gl.FLOAT, c.cols)
    } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, 1, gl.RGBA, gl.FLOAT, c.cols)
    gl.uniform1i(this.u(p, 'h'), 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.glowTex)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c.glow)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.uniform1i(this.u(p, 'glow'), 1)
    gl.activeTexture(gl.TEXTURE0)
    const x1 = this.W, y0 = c.cy, y1 = c.cy + c.ch
    gl.bindVertexArray(this.cvao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cbuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, y0, x1, y0, x1, y1, 0, y0, x1, y1, 0, y1]), gl.STREAM_DRAW)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }
}
