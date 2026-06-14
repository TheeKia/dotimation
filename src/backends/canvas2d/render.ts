import type { ParticleField } from '@/types'

const IS_LITTLE_ENDIAN = (() => {
  const buf = new ArrayBuffer(4)
  new Uint32Array(buf)[0] = 0x01020304
  return new Uint8Array(buf)[0] === 0x04
})()

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0
}

/**
 * Renders the field into a Uint32Array view of an RGBA buffer with manual
 * source-over compositing. The endianness branch is resolved once up front,
 * not per pixel. `dotSize` is the square footprint in device pixels.
 */
export function renderField(
  view: Uint32Array,
  field: ParticleField,
  devW: number,
  devH: number,
  dpr: number,
  dotSize: number,
): void {
  view.fill(0)
  const size = Math.max(1, Math.round(dotSize))
  const little = IS_LITTLE_ENDIAN

  const pack = little
    ? (r: number, g: number, b: number, a: number): number =>
        ((a << 24) | (b << 16) | (g << 8) | r) >>> 0
    : (r: number, g: number, b: number, a: number): number =>
        ((r << 24) | (g << 16) | (b << 8) | a) >>> 0

  for (let i = 0; i < field.count; i++) {
    const sa = field.alpha[i]!
    if (sa <= 0) continue
    const clampedA = sa >= 1 ? 1 : sa
    const sr = clamp255(field.r[i]!)
    const sg = clamp255(field.g[i]!)
    const sb = clamp255(field.b[i]!)
    const baseX = (field.x[i]! * dpr + 0.5) | 0
    const baseY = (field.y[i]! * dpr + 0.5) | 0

    for (let oy = 0; oy < size; oy++) {
      const yDev = baseY + oy
      if (yDev < 0 || yDev >= devH) continue
      for (let ox = 0; ox < size; ox++) {
        const xDev = baseX + ox
        if (xDev < 0 || xDev >= devW) continue
        const idx = yDev * devW + xDev
        const dst = view[idx]!
        if (dst === 0) {
          view[idx] = pack(sr, sg, sb, (clampedA * 255 + 0.5) | 0)
          continue
        }
        const dr = little ? dst & 0xff : (dst >>> 24) & 0xff
        const dg = little ? (dst >>> 8) & 0xff : (dst >>> 16) & 0xff
        const db = little ? (dst >>> 16) & 0xff : (dst >>> 8) & 0xff
        const da = (little ? (dst >>> 24) & 0xff : dst & 0xff) / 255
        const outA = clampedA + da * (1 - clampedA)
        const outR = (sr * clampedA + dr * da * (1 - clampedA)) / outA
        const outG = (sg * clampedA + dg * da * (1 - clampedA)) / outA
        const outB = (sb * clampedA + db * da * (1 - clampedA)) / outA
        view[idx] = pack(
          (outR + 0.5) | 0,
          (outG + 0.5) | 0,
          (outB + 0.5) | 0,
          (outA * 255 + 0.5) | 0,
        )
      }
    }
  }
}
