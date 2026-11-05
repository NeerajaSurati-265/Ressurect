/**
 * The gate's transition, drawn on one half-resolution 2D canvas (scaled up by CSS; fog is soft
 * anyway):
 *
 *   0 - 1.0 s   fog rolls in over the video until the screen is fully covered
 *   1.0 - 2.4 s the Keeper's lantern glow blooms where it stands and burns a widening opening
 *               through the fog: an uneven, smoky edge (radius wobbles on three drifting
 *               octaves) with a soft falloff built from stacked cuts (no canvas filter needed)
 *
 * No dependencies; never throws into React.
 */
export interface RevealHandle {
  cancel(): void
}

interface Options {
  /** 0..1 while the fog rolls in */
  onFogProgress?(k: number): void
  /** the screen is fully covered (called once, at 1.0 s) */
  onCovered?(): void
  onDone(): void
}

const FOG_MS = 1000
const REVEAL_MS = 1400
const SCALE = 0.5

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (x: number) => {
  const k = clamp01(x)
  return k * k * (3 - 2 * k)
}
const easeInCubic = (x: number) => x * x * x
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3

/** A small tileable-ish fbm cloud texture (value noise), made once. */
function fogTexture(w = 192, h = 108): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  if (!g) return c
  const img = g.createImageData(w, h)
  const grid = (n: number) => {
    const a = new Float32Array((n + 1) * (n + 1))
    for (let i = 0; i < a.length; i++) a[i] = Math.random()
    return { n, a }
  }
  const octaves = [grid(4), grid(8), grid(16), grid(32)]
  const sample = (o: { n: number; a: Float32Array }, x: number, y: number) => {
    const fx = x * o.n
    const fy = y * o.n
    const ix = Math.floor(fx)
    const iy = Math.floor(fy)
    const tx = smooth(fx - ix)
    const ty = smooth(fy - iy)
    const s = o.n + 1
    const v00 = o.a[iy * s + ix]
    const v10 = o.a[iy * s + ix + 1]
    const v01 = o.a[(iy + 1) * s + ix]
    const v11 = o.a[(iy + 1) * s + ix + 1]
    return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0
      let amp = 0.55
      for (const o of octaves) {
        v += amp * sample(o, x / w, y / h)
        amp *= 0.5
      }
      v = clamp01((v - 0.25) / 0.75)
      const i = (y * w + x) * 4
      // cold moonlit mist: pale blue-grey, alpha follows density
      img.data[i] = 120 + v * 70
      img.data[i + 1] = 134 + v * 70
      img.data[i + 2] = 170 + v * 60
      img.data[i + 3] = Math.round(v * 255)
    }
  }
  g.putImageData(img, 0, 0)
  return c
}

function readLantern(w: number, h: number): { x: number; y: number } {
  try {
    const cs = getComputedStyle(document.documentElement)
    const x = parseFloat(cs.getPropertyValue('--keeper-lx'))
    const y = parseFloat(cs.getPropertyValue('--keeper-ly'))
    if (Number.isFinite(x) && Number.isFinite(y) && x > 0 && y > 0 && x < w && y < h) return { x, y }
  } catch {
    /* fall through */
  }
  const a = document.querySelector('[data-keeper-anchor="url-input"]')
  if (a) {
    const r = a.getBoundingClientRect()
    if (r.width > 0 && r.bottom > 0 && r.top < h) return { x: Math.max(24, r.left - 40), y: r.top + r.height / 2 }
  }
  return { x: w * 0.5, y: h * 0.68 }
}

export function revealLantern(canvas: HTMLCanvasElement, opts: Options): RevealHandle {
  let raf = 0
  let cancelled = false
  const ctx = canvas.getContext('2d')
  const vw = () => window.innerWidth
  const vh = () => window.innerHeight
  const fit = () => {
    canvas.width = Math.max(1, Math.round(vw() * SCALE))
    canvas.height = Math.max(1, Math.round(vh() * SCALE))
  }
  fit()
  window.addEventListener('resize', fit)

  const done = () => {
    window.removeEventListener('resize', fit)
    if (!cancelled) {
      cancelled = true
      opts.onDone()
    }
  }

  if (!ctx) {
    opts.onFogProgress?.(1)
    opts.onCovered?.()
    done()
    return { cancel: () => cancelAnimationFrame(raf) }
  }

  const texA = fogTexture()
  const texB = fogTexture(128, 72)
  const seeds = [Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28]
  const t0 = performance.now()
  let covered = false
  let coveredAt = 0
  let frames = 0
  let lantern: { x: number; y: number } | null = null

  const drawFog = (t: number, k: number) => {
    const W = canvas.width
    const H = canvas.height
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, W, H)
    // the dark body of the fog
    ctx.fillStyle = `rgba(9, 11, 24, ${(0.15 + 0.85 * smooth(k)).toFixed(3)})`
    ctx.fillRect(0, 0, W, H)
    // two cloud layers rolling in from the sides, then drifting slowly
    const roll = 1 - easeOutCubic(clamp01(k))
    const drift = t * 0.00002
    ctx.globalAlpha = 0.25 + 0.6 * smooth(k)
    ctx.drawImage(texA, -W * 0.25 - roll * W * 0.9 + Math.sin(drift * 40) * W * 0.03, -H * 0.15, W * 1.5, H * 1.3)
    ctx.globalAlpha = 0.18 + 0.45 * smooth(k)
    ctx.drawImage(texB, -W * 0.2 + roll * W * 0.8 - Math.sin(drift * 30) * W * 0.04, -H * 0.1, W * 1.4, H * 1.25)
    ctx.globalAlpha = 1
  }

  /** A filled blob around (cx, cy) of radius r with a smoky, slowly drifting edge. */
  const blob = (cx: number, cy: number, r: number, t: number) => {
    const n = 96
    ctx.beginPath()
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2
      const wob =
        0.075 * Math.sin(3 * a + t * 0.0011 + seeds[0]) +
        0.05 * Math.sin(5 * a - t * 0.0016 + seeds[1]) +
        0.03 * Math.sin(11 * a + t * 0.0027 + seeds[2])
      const rr = r * (1 + wob)
      const x = cx + Math.cos(a) * rr
      const y = cy + Math.sin(a) * rr
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fill()
  }

  const step = (now: number) => {
    if (cancelled) return
    const t = now - t0
    const W = canvas.width
    const H = canvas.height

    if (!covered) {
      const k = clamp01(t / FOG_MS)
      opts.onFogProgress?.(k)
      drawFog(t, k)
      if (k >= 1) {
        covered = true
        coveredAt = now
        opts.onCovered?.()
      }
      raf = requestAnimationFrame(step)
      return
    }

    drawFog(t, 1)
    // give the Keeper two frames to place itself and write its lantern position
    frames++
    if (!lantern && frames >= 3) lantern = readLantern(vw(), vh())
    if (!lantern) {
      raf = requestAnimationFrame(step)
      return
    }

    const k = clamp01((now - coveredAt) / REVEAL_MS)
    const cx = lantern.x * SCALE
    const cy = lantern.y * SCALE
    const diag = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy))
    const open = easeInCubic(clamp01((k - 0.12) / 0.88))
    const r = 6 + open * diag * 1.25
    const glowIn = smooth(k / 0.2)
    const glowOut = 1 - smooth((k - 0.7) / 0.3)

    // warm lantern light soaking into the fog around the opening
    const lr = Math.max(40, r * 1.6 + 70 * glowIn)
    const warm = ctx.createRadialGradient(cx, cy, 0, cx, cy, lr)
    warm.addColorStop(0, `rgba(255, 196, 120, ${(0.85 * glowIn * glowOut).toFixed(3)})`)
    warm.addColorStop(0.35, `rgba(255, 138, 31, ${(0.35 * glowIn * glowOut).toFixed(3)})`)
    warm.addColorStop(1, 'rgba(255, 106, 0, 0)')
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = warm
    ctx.fillRect(0, 0, W, H)

    // burn the opening: stacked cuts make a soft, smoky falloff
    if (open > 0) {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = '#000'
      const layers = [1.18, 1.1, 1.04, 1, 0.94, 0.86]
      layers.forEach((m, i) => {
        ctx.globalAlpha = i === layers.length - 1 ? 1 : 0.22
        blob(cx, cy, r * m, t + i * 90)
      })
      ctx.globalAlpha = 1
    }
    ctx.globalCompositeOperation = 'source-over'

    if (k >= 1) {
      ctx.clearRect(0, 0, W, H)
      done()
      return
    }
    raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)

  return {
    cancel() {
      cancelled = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
    },
  }
}
