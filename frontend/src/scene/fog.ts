/**
 * Raw WebGL1 volumetric ground fog: domain-warped fbm in a single full-screen triangle.
 * Cold moonlight on the side facing the moon, warm light pooled around ember sources.
 * Output is premultiplied alpha; the canvas is composited between the scene and the content.
 */

/** Render-resolution multiplier on top of devicePixelRatio (desktop). Tune for performance. */
export const FOG_SCALE = 0.5
/** Same, for phones (< 640 px wide). */
export const FOG_SCALE_MOBILE = 0.33
/** Frame cap for the fog loop. */
export const FOG_FPS = 30
/** Max ember (warm light) sources. Keep in sync with the shader array size. */
export const MAX_EMBERS = 4

export function fogScale(viewportWidth: number) {
  return viewportWidth < 640 ? FOG_SCALE_MOBILE : FOG_SCALE
}

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`

// ~5 octaves max, no textures. Everything is computed in uv space with y = 0 at the TOP.
const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_moon;      // px, y-down, canvas resolution
uniform vec3 u_embers[4]; // xy px (y-down), z intensity 0..1.5

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
const mat2 ROT = mat2(1.6, 1.2, -1.2, 1.6);
float fbm4(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = ROT * p; a *= 0.5; }
  return v;
}
float fbm5(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = ROT * p; a *= 0.5; }
  return v;
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 uv = px / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = u_time;

  // domain warp: a slow swirling offset field
  vec2 q = vec2(
    fbm4(p * 1.4 + vec2(t * 0.018, -t * 0.006)),
    fbm4(p * 1.4 + vec2(5.2 - t * 0.012, 1.3 + t * 0.004))
  );
  // layer 1: broad rolling banks, drifting right; stretched horizontally
  float bank = fbm5(vec2(p.x * 1.1, p.y * 2.6) + 1.7 * q + vec2(t * 0.022, 0.0));
  // layer 2: finer curls drifting left, a little faster
  float curl = fbm4(vec2(p.x * 2.6, p.y * 4.2) + 1.1 * q.yx + vec2(-t * 0.035, t * 0.004));

  // height profile: thick in the lowest ~40%, thin wisps above
  float ground = smoothstep(0.55, 1.0, uv.y);
  float mid = smoothstep(0.18, 0.62, uv.y) * (1.0 - ground);
  float dBank = smoothstep(0.38, 0.82, bank);
  float dCurl = smoothstep(0.45, 0.85, curl);
  float density = ground * (0.48 * dBank + 0.2 * dCurl + 0.08)
                + mid * (0.12 * dBank * dCurl + 0.04 * dCurl);

  // keep the upper centre (where content lives) clear, fade at the very edges
  float centre = 1.0 - 0.55 * smoothstep(0.6, 0.0, length((uv - vec2(0.5, 0.35)) * vec2(1.3, 1.6))) * (1.0 - ground);
  density *= centre;

  // cold key light: the moon, plus a broad moon-side gradient (upper left)
  float md = length((px - u_moon) / u_res.y);
  float moonGlow = exp(-md * 2.6);
  float moonSide = 0.6 + 0.4 * (1.0 - uv.x);
  vec3 fogCol = vec3(0.50, 0.57, 0.72) * moonSide;
  vec3 col = fogCol + vec3(0.72, 0.80, 0.95) * moonGlow * 0.55;
  // lit fog edges: brighter where the bank thins toward the moon
  col += vec3(0.55, 0.62, 0.78) * moonGlow * smoothstep(0.5, 0.75, bank) * 0.25;

  // warm fill: embers (pumpkins, the Keeper's lantern)
  vec3 warm = vec3(0.0);
  float warmA = 0.0;
  for (int i = 0; i < 4; i++) {
    vec3 e = u_embers[i];
    vec2 d = (px - e.xy) / u_res.y;
    float w = e.z * exp(-dot(d, d) * 38.0);
    warm += vec3(1.0, 0.52, 0.16) * w;
    warmA += w;
  }
  col += warm * 0.9;
  float a = density * (1.0 + 0.7 * min(warmA, 1.0));
  a = clamp(a, 0.0, 0.42);
  gl_FragColor = vec4(col * a, a);
}
`

export type Ember = { x: number; y: number; i: number }

export interface FogRenderer {
  /** Resize the drawing buffer to css size * dpr * scale. */
  resize(cssW: number, cssH: number, pixelRatio: number): void
  /** Draw one frame. Moon and embers are in CSS px, y-down. */
  draw(timeS: number, moon: { x: number; y: number }, embers: Ember[]): void
  /** Free GPU resources; `lose` also releases the context (only for a permanent teardown). */
  dispose(lose?: boolean): void
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)
  if (!s) return null
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn('[resurrect] fog shader:', gl.getShaderInfoLog(s))
    gl.deleteShader(s)
    return null
  }
  return s
}

/** Backstop for browsers that ignore failIfMajorPerformanceCaveat. */
function isSoftwareRenderer(gl: WebGLRenderingContext) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '')
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name)
  } catch {
    return false
  }
}

/** Returns null when WebGL is unavailable, software-only or the shader fails, so the caller falls back to CSS fog. */
export function createFogRenderer(canvas: HTMLCanvasElement): FogRenderer | null {
  let gl: WebGLRenderingContext | null = null
  try {
    gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
      // software GL (no GPU) compiles and runs this shader on the CPU and freezes the page: refuse it
      failIfMajorPerformanceCaveat: true,
    }) as WebGLRenderingContext | null
  } catch {
    gl = null
  }
  if (!gl) return null
  if (isSoftwareRenderer(gl)) {
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return null
  }
  const vs = compile(gl, gl.VERTEX_SHADER, VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
  if (!vs || !fs) return null
  const prog = gl.createProgram()
  if (!prog) return null
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('[resurrect] fog link:', gl.getProgramInfoLog(prog))
    return null
  }
  gl.useProgram(prog)
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  // one oversized triangle covers the screen
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'a_pos')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  const uRes = gl.getUniformLocation(prog, 'u_res')
  const uTime = gl.getUniformLocation(prog, 'u_time')
  const uMoon = gl.getUniformLocation(prog, 'u_moon')
  const uEmbers = gl.getUniformLocation(prog, 'u_embers')
  const emberBuf = new Float32Array(MAX_EMBERS * 3)
  gl.disable(gl.BLEND)
  gl.clearColor(0, 0, 0, 0)
  let k = 1 // css px -> buffer px

  const g = gl
  return {
    resize(cssW, cssH, pixelRatio) {
      const w = Math.max(1, Math.round(cssW * pixelRatio))
      const h = Math.max(1, Math.round(cssH * pixelRatio))
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
      k = w / Math.max(1, cssW)
      g.viewport(0, 0, w, h)
      g.uniform2f(uRes, w, h)
    },
    draw(timeS, moon, embers) {
      if (g.isContextLost()) return
      g.uniform1f(uTime, timeS)
      g.uniform2f(uMoon, moon.x * k, moon.y * k)
      emberBuf.fill(0)
      for (let i = 0; i < Math.min(MAX_EMBERS, embers.length); i++) {
        emberBuf[i * 3] = embers[i].x * k
        emberBuf[i * 3 + 1] = embers[i].y * k
        emberBuf[i * 3 + 2] = embers[i].i
      }
      g.uniform3fv(uEmbers, emberBuf)
      g.clear(g.COLOR_BUFFER_BIT)
      g.drawArrays(g.TRIANGLES, 0, 3)
    },
    dispose(lose) {
      try {
        g.deleteBuffer(buf)
        g.deleteProgram(prog)
        g.deleteShader(vs)
        g.deleteShader(fs)
        if (lose) g.getExtension('WEBGL_lose_context')?.loseContext()
      } catch {
        /* ignore */
      }
    },
  }
}
