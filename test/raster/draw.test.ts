import { describe, expect, test } from 'bun:test'
import { resolveFontSize } from '@/raster/draw'

const text = (data: string, fontSize?: number | 'AUTO' | 'AUTO_MONO') =>
  ({ type: 'text', data, fontSize }) as const

describe('resolveFontSize', () => {
  test('respects an explicit numeric size verbatim, even if it overflows', () => {
    expect(resolveFontSize(text('hi', 200), 500, 50)).toBe(200)
  })

  test('AUTO is clamped so all lines fit the height', () => {
    // 8 lines at 1.2 line-height in 120px of height => at most 12.5px each.
    const size = resolveFontSize(text('a\nb\nc\nd\ne\nf\ng\nh'), 2000, 120)
    expect(size * 8 * 1.2).toBeLessThanOrEqual(120 + 1e-9)
    expect(size).toBeGreaterThanOrEqual(10)
  })

  test('AUTO_MONO is clamped the same way', () => {
    const size = resolveFontSize(
      text('a\nb\nc\nd\ne\nf\ng\nh', 'AUTO_MONO'),
      2000,
      120,
    )
    expect(size * 8 * 1.2).toBeLessThanOrEqual(120 + 1e-9)
  })

  test('height clamp never goes below the 10px floor', () => {
    const size = resolveFontSize(text('a\nb\nc\nd\ne\nf\ng\nh'), 2000, 10)
    expect(size).toBe(10)
  })

  test('single-line AUTO in a tall canvas is not affected by the clamp', () => {
    expect(resolveFontSize(text('hello'), 500, 10_000)).toBe(
      resolveFontSize(text('hello'), 500, 500),
    )
  })
})
