import type { FieldTargets } from '@/types'

/**
 * Samples a device-pixel RGBA buffer into FieldTargets. Pure and DOM-free.
 * `rand` is injectable for deterministic tests (defaults to Math.random).
 */
export function sampleTargets(
  pixels: Uint8ClampedArray,
  devW: number,
  devH: number,
  dpr: number,
  pointSpacingCss: number,
  alpha: number,
  rand: () => number = Math.random,
  maxParticles: number = Number.POSITIVE_INFINITY,
): FieldTargets {
  const step = Math.max(1, Math.round(pointSpacingCss * dpr))
  const xs: number[] = []
  const ys: number[] = []
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []

  for (let yDev = 0; yDev < devH; yDev += step) {
    for (let xDev = 0; xDev < devW; xDev += step) {
      const idx = (yDev * devW + xDev) * 4
      if (pixels[idx + 3]! > alpha) {
        xs.push(xDev / dpr)
        ys.push(yDev / dpr)
        rs.push(pixels[idx]!)
        gs.push(pixels[idx + 1]!)
        bs.push(pixels[idx + 2]!)
      }
    }
  }

  const n = xs.length
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
