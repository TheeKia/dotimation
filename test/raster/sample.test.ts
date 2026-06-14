import { describe, expect, test } from 'bun:test'
import { sampleTargets } from '@/raster/sample'

// 2x2 device image, dpr 1, step 1, one opaque red pixel at (1,0).
function img(): Uint8ClampedArray {
  const p = new Uint8ClampedArray(2 * 2 * 4)
  const idx = (0 * 2 + 1) * 4
  p[idx] = 255
  p[idx + 1] = 0
  p[idx + 2] = 0
  p[idx + 3] = 255
  return p
}

describe('sampleTargets', () => {
  test('emits one target at the opaque pixel in CSS coords', () => {
    const t = sampleTargets(img(), 2, 2, 1, 1, 128, () => 0)
    expect(t.count).toBe(1)
    expect(t.homeX[0]).toBe(1)
    expect(t.homeY[0]).toBe(0)
    expect(t.homeR[0]).toBe(255)
    expect(t.homeB[0]).toBe(0)
  })

  test('skips pixels at or below the alpha threshold', () => {
    const p = img()
    p[(0 * 2 + 1) * 4 + 3] = 128 // exactly threshold → excluded (> alpha)
    expect(sampleTargets(p, 2, 2, 1, 1, 128, () => 0).count).toBe(0)
  })

  test('converts device coords to CSS using dpr', () => {
    const p = new Uint8ClampedArray(4 * 4 * 4)
    const idx = (2 * 4 + 2) * 4
    p[idx + 3] = 255
    const t = sampleTargets(p, 4, 4, 2, 1, 128, () => 0)
    expect(t.homeX[0]).toBe(1) // 2 device px / dpr 2
    expect(t.homeY[0]).toBe(1)
  })
})
