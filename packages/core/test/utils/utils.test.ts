import { afterEach, describe, expect, test } from 'bun:test'
import { getDpr } from '../../src/utils/utils'

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

  test('accepts a custom cap', () => {
    g.window = { devicePixelRatio: 3 }
    expect(getDpr(3)).toBe(3)
    expect(getDpr(1)).toBe(1)
  })
})

test('invalid density caps and device ratios use safe defaults', () => {
  g.window = { devicePixelRatio: 3 }
  for (const cap of [0, -1, NaN, Infinity]) expect(getDpr(cap)).toBe(2)
  for (const ratio of [0, -1, NaN, Infinity]) {
    g.window = { devicePixelRatio: ratio }
    expect(getDpr()).toBe(1)
  }
})
