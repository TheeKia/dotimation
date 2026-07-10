import { describe, expect, test } from 'bun:test'
import { createFastRand, toUnit, xorshift32 } from '@/utils/prng'

describe('xorshift32', () => {
  test('never returns 0 from a nonzero state (full-period generator)', () => {
    let s = 1
    for (let i = 0; i < 10_000; i++) {
      s = xorshift32(s)
      expect(s).not.toBe(0)
    }
  })
  test('is deterministic', () => {
    expect(xorshift32(12345)).toBe(xorshift32(12345))
  })
})

describe('toUnit', () => {
  test('maps the maximum 32-bit state strictly below 1', () => {
    // Regression: dividing by 0xffffffff made rand() === 1 possible, which
    // pushed the Fisher–Yates pick in sampleTargets out of bounds (NaN dot).
    expect(toUnit(0xffffffff)).toBeLessThan(1)
    expect(toUnit(0xffffffff)).toBeGreaterThan(0.999)
  })
  test('maps the minimum nonzero state to (0, 1)', () => {
    expect(toUnit(1)).toBeGreaterThan(0)
    expect(toUnit(1)).toBeLessThan(1)
  })
})

describe('createFastRand', () => {
  test('same seed, same sequence; stays in [0, 1)', () => {
    const a = createFastRand(42)
    const b = createFastRand(42)
    for (let i = 0; i < 1000; i++) {
      const v = a()
      expect(v).toBe(b())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
  test('a zero-ish seed still produces a live generator', () => {
    const r = createFastRand(0x9e3779b9) // seed ^ 0x9e3779b9 === 0 → fallback 1
    expect(r()).toBeGreaterThan(0)
  })
})
