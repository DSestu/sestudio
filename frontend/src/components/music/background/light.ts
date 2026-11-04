import { program } from '../timeline/gl'

// The light's blur in WebGL (SPEC-music-player §5.8): the small painted frame is blurred and saturated,
// with a wider, dimmer copy behind for the bloom, into the small visible canvas the page scales up. The
// same as the 2D canvas filters it replaces (gaussian blur, transparent outside, then CSS saturate()).
// It stays small: on the TV station's software renderer a full-screen pass costs more than the zoom.

const QUAD_VS = `#version 300 es
layout(location = 0) in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

// One pass of a separable gaussian, transparent outside the image; the vertical pass also saturates.
const BLUR_FS = `#version 300 es
precision highp float; in vec2 uv; uniform sampler2D s; uniform ivec2 dir; uniform float sigma; uniform float sat; out vec4 o;
void main() {
  ivec2 size = textureSize(s, 0), at = ivec2(gl_FragCoord.xy);
  vec4 sum = vec4(0.0);
  if (sigma < 0.01) sum = texelFetch(s, at, 0);
  else {
    int r = int(ceil(sigma * 3.0));
    float wsum = 0.0;
    for (int i = -r; i <= r; i++) {
      float w = exp(-float(i * i) / (2.0 * sigma * sigma));
      wsum += w;
      ivec2 q = at + dir * i;
      if (q.x >= 0 && q.y >= 0 && q.x < size.x && q.y < size.y) sum += texelFetch(s, q, 0) * w;
    }
    sum /= wsum;
  }
  if (sat >= 0.0) {
    mat3 m = mat3(0.213 + 0.787 * sat, 0.213 - 0.213 * sat, 0.213 - 0.213 * sat,
                  0.715 - 0.715 * sat, 0.715 + 0.285 * sat, 0.715 - 0.715 * sat,
                  0.072 - 0.072 * sat, 0.072 - 0.072 * sat, 0.072 + 0.928 * sat);
    sum.rgb = clamp(m * sum.rgb, 0.0, sum.a);
  }
  o = sum;
}`

// The frame drawn larger, for the bloom's spill.
const SCALE_FS = `#version 300 es
precision highp float; in vec2 uv; uniform sampler2D s; uniform float k; out vec4 o;
void main() {
  vec2 q = (uv - 0.5) / k + 0.5;
  o = any(lessThan(q, vec2(0.0))) || any(greaterThan(q, vec2(1.0))) ? vec4(0.0) : texture(s, q);
}`

// The visible canvas: the blurred frame with the bloom added. Textures hold the frame top row first;
// the canvas's uv starts at the bottom.
const OUT_FS = `#version 300 es
precision highp float; in vec2 uv; uniform sampler2D s; uniform sampler2D bloom; uniform float bloomA; out vec4 o;
void main() {
  vec2 q = vec2(uv.x, 1.0 - uv.y);
  o = min(texture(s, q) + texture(bloom, q) * bloomA, vec4(1.0));
}`

interface Fb { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

export class Light {
  private gl: WebGL2RenderingContext
  private canvas: HTMLCanvasElement
  private blurP!: WebGLProgram
  private scaleP!: WebGLProgram
  private outP!: WebGLProgram
  private vao!: WebGLVertexArrayObject
  private src!: WebGLTexture
  private fbs: Fb[] = []
  private locs = new Map<string, WebGLUniformLocation | null>()

  constructor(canvas: HTMLCanvasElement, onRestore: () => void) {
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: true, depth: false, stencil: false })
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl
    this.canvas = canvas
    this.init()
    canvas.addEventListener('webglcontextlost', e => e.preventDefault())
    canvas.addEventListener('webglcontextrestored', () => { this.init(); onRestore() })
  }

  private u(p: WebGLProgram, name: string) {
    const key = (p === this.blurP ? 'b:' : p === this.scaleP ? 's:' : 'o:') + name
    let l = this.locs.get(key)
    if (l === undefined) this.locs.set(key, (l = this.gl.getUniformLocation(p, name)))
    return l
  }

  private tex() {
    const gl = this.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }

  private init() {
    const gl = this.gl
    this.locs.clear()
    this.fbs = []
    this.blurP = program(gl, QUAD_VS, BLUR_FS)
    this.scaleP = program(gl, QUAD_VS, SCALE_FS)
    this.outP = program(gl, QUAD_VS, OUT_FS)
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.src = this.tex()
  }

  /** Four small targets at the painted frame's size. */
  private targets(w: number, h: number) {
    const gl = this.gl
    if (this.fbs.length && this.fbs[0].w === w && this.fbs[0].h === h) return this.fbs
    for (const f of this.fbs) { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex) }
    this.fbs = Array.from({ length: 4 }, () => {
      const tex = this.tex()
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      const fb = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      return { fb, tex, w, h }
    })
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return this.fbs
  }

  private pass(p: WebGLProgram, to: Fb | null, src: WebGLTexture, set: () => void) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, to ? to.fb : null)
    gl.viewport(0, 0, to ? to.w : this.canvas.width, to ? to.h : this.canvas.height)
    gl.useProgram(p)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, src)
    gl.uniform1i(this.u(p, 's'), 0)
    set()
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  private blur(from: WebGLTexture, tmp: Fb, to: Fb, sigma: number, sat: number) {
    const gl = this.gl
    this.pass(this.blurP, tmp, from, () => {
      gl.uniform2i(this.u(this.blurP, 'dir'), 1, 0)
      gl.uniform1f(this.u(this.blurP, 'sigma'), sigma)
      gl.uniform1f(this.u(this.blurP, 'sat'), -1)
    })
    this.pass(this.blurP, to, tmp.tex, () => {
      gl.uniform2i(this.u(this.blurP, 'dir'), 0, 1)
      gl.uniform1f(this.u(this.blurP, 'sigma'), sigma)
      gl.uniform1f(this.u(this.blurP, 'sat'), sat)
    })
  }

  /** Blurs `scratch` by `blur` of its pixels and saturates it, with a bloom copy at `bloom` (0: none), into the canvas (resized to match). */
  frame(scratch: HTMLCanvasElement, blur: number, sat: number, bloom: number) {
    const gl = this.gl
    if (gl.isContextLost()) return
    const w = scratch.width, h = scratch.height
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    const [a, b, c, d] = this.targets(w, h)
    gl.disable(gl.BLEND)
    gl.bindTexture(gl.TEXTURE_2D, this.src)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scratch)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    this.blur(this.src, a, b, blur, sat)
    if (bloom) {
      // A very wide, dim copy behind: the light spills a little into the sky.
      this.pass(this.scaleP, c, this.src, () => gl.uniform1f(this.u(this.scaleP, 'k'), 1.15))
      this.blur(c.tex, a, d, w / 22, sat)
    }
    this.pass(this.outP, null, b.tex, () => {
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, d.tex)
      gl.uniform1i(this.u(this.outP, 'bloom'), 1)
      gl.activeTexture(gl.TEXTURE0)
      gl.uniform1f(this.u(this.outP, 'bloomA'), bloom)
    })
  }
}
