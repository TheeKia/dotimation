import { afterEach, describe, expect, test } from 'bun:test'
import { getDpr } from '@/utils/utils'

const g = globalThis as { window?: { devicePixelRatio?: number } }

afterEach(() => {
  delete g.window
})

describe('getDpr', () => {
  test('returns 1 outside a browser', () => {
    expect(getDpr()).toBe(1)
  })

  test('caps devicePixelRatio at 2', () => {
    g.window = { devicePixelRatio: 3 }
    expect(getDpr()).toBe(2)
  })

  test('defaults a missing ratio to 1', () => {
    g.window = {}
    expect(getDpr()).toBe(1)
  })

  test('passes through ratios below the cap', () => {
    g.window = { devicePixelRatio: 1.5 }
    expect(getDpr()).toBe(1.5)
  })
})
