import { describe, expect, test } from 'bun:test'
import { type RasterInputs, sameRasterInputs } from '@/raster/inputs'
import type { AnimateItem } from '@/types'

const base = (over: Partial<RasterInputs> = {}): RasterInputs => ({
  item: { type: 'text', data: 'hi' } as AnimateItem,
  width: 100,
  height: 50,
  defaultFontFamily: 'sans-serif',
  alpha: 128,
  pointSpacingCss: 2,
  maxParticles: Number.POSITIVE_INFINITY,
  maxDpr: 2,
  dprEpoch: 0,
  fontEpoch: 0,
  ...over,
})

describe('sameRasterInputs', () => {
  test('equal inputs (fresh but shallow-equal item objects) compare equal', () => {
    expect(sameRasterInputs(base(), base())).toBe(true)
  })
  test('item content change is detected', () => {
    expect(
      sameRasterInputs(base(), base({ item: { type: 'text', data: 'yo' } })),
    ).toBe(false)
  })
  test.each([
    ['width', { width: 101 }],
    ['height', { height: 51 }],
    ['defaultFontFamily', { defaultFontFamily: 'serif' }],
    ['alpha', { alpha: 64 }],
    ['pointSpacingCss', { pointSpacingCss: 3 }],
    ['maxParticles', { maxParticles: 500 }],
    ['maxDpr', { maxDpr: 3 }],
    ['dprEpoch', { dprEpoch: 1 }],
    ['fontEpoch', { fontEpoch: 1 }],
  ] as const)('%s change is detected (regression: was ignored)', (_n, over) => {
    expect(sameRasterInputs(base(), base(over))).toBe(false)
  })
})
