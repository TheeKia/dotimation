import { describe, expect, test } from 'bun:test'
import { cssToClipX, cssToClipY } from '@/engine/viewport'

describe('cssToClipX', () => {
  test('maps left edge to -1 and right edge to +1', () => {
    // devW = 200, dpr = 2 → CSS width 100
    expect(cssToClipX(0, 200, 2)).toBeCloseTo(-1, 6)
    expect(cssToClipX(100, 200, 2)).toBeCloseTo(1, 6)
    expect(cssToClipX(50, 200, 2)).toBeCloseTo(0, 6)
  })
})

describe('cssToClipY', () => {
  test('flips Y: top edge to +1, bottom edge to -1', () => {
    expect(cssToClipY(0, 200, 2)).toBeCloseTo(1, 6)
    expect(cssToClipY(100, 200, 2)).toBeCloseTo(-1, 6)
    expect(cssToClipY(50, 200, 2)).toBeCloseTo(0, 6)
  })
})
