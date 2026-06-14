import type { FieldTargets } from '@/types'

// Cheap xorshift32 PRNG for the candidate shuffle — uniform enough for a random
// subset, and far cheaper than Math.random when sampling tens of thousands of
// pixels. `rand` stays injectable below so tests are deterministic.
let rngState = (Date.now() ^ 0x9e3779b9) >>> 0 || 1
function fastRand(): number {
  rngState ^= rngState << 13
  rngState ^= rngState >>> 17
  rngState ^= rngState << 5
  rngState >>>= 0
  return rngState / 0xffffffff
}

/**
 * Samples a device-pixel RGBA buffer into FieldTargets. Pure and DOM-free.
 * `rand` is injectable for deterministic tests (defaults to a fast PRNG).
 */
export function sampleTargets(
  pixels: Uint8ClampedArray,
  devW: number,
  devH: number,
  dpr: number,
  pointSpacingCss: number,
  alpha: number,
  rand: () => number = fastRand,
  maxParticles: number = Number.POSITIVE_INFINITY,
): FieldTargets {
  const step = Math.max(1, Math.round(pointSpacingCss * dpr))
  // The grid has at most ceil(devW/step) * ceil(devH/step) cells, so the
  // candidate arrays are preallocated to that bound and filled with a cursor —
  // avoiding boxed number[] growth and the GC churn of push() on large images.
  const maxN = Math.ceil(devW / step) * Math.ceil(devH / step)
  const xs = new Float32Array(maxN)
  const ys = new Float32Array(maxN)
  const rs = new Uint8Array(maxN)
  const gs = new Uint8Array(maxN)
  const bs = new Uint8Array(maxN)
  let n = 0

  for (let yDev = 0; yDev < devH; yDev += step) {
    for (let xDev = 0; xDev < devW; xDev += step) {
      const idx = (yDev * devW + xDev) * 4
      if (pixels[idx + 3]! > alpha) {
        xs[n] = xDev / dpr
        ys[n] = yDev / dpr
        rs[n] = pixels[idx]!
        gs[n] = pixels[idx + 1]!
        bs[n] = pixels[idx + 2]!
        n++
      }
    }
  }
  const keep = Math.min(n, Math.max(0, Math.floor(maxParticles)))
  const order = new Uint32Array(n)
  for (let i = 0; i < n; i++) order[i] = i
  // Partial Fisher–Yates: only the first `keep` picks are needed to draw a
  // uniform random subset, so the shuffle is O(keep), not O(n). When uncapped
  // (keep === n) this degrades gracefully to a full shuffle.
  for (let i = 0; i < keep; i++) {
    const j = i + ((rand() * (n - i)) | 0)
    const tmp = order[i]!
    order[i] = order[j]!
    order[j] = tmp
  }
  const t: FieldTargets = {
    count: keep,
    homeX: new Float32Array(keep),
    homeY: new Float32Array(keep),
    homeR: new Float32Array(keep),
    homeG: new Float32Array(keep),
    homeB: new Float32Array(keep),
  }
  for (let i = 0; i < keep; i++) {
    const k = order[i]!
    t.homeX[i] = xs[k]!
    t.homeY[i] = ys[k]!
    t.homeR[i] = rs[k]!
    t.homeG[i] = gs[k]!
    t.homeB[i] = bs[k]!
  }
  return t
}
