import { describe, expect, test } from 'bun:test'
import { accumulate, FIXED_DT } from '@/engine/clock'

describe('accumulate', () => {
  test('emits the right number of fixed steps for a frame', () => {
    const r = accumulate(0, 1 / 30)
    expect(r.steps).toBe(3)
    expect(r.accumulator).toBeCloseTo(1 / 30 - 3 * FIXED_DT, 6)
  })

  test('clamps a huge frame delta to maxSteps', () => {
    const r = accumulate(0, 10)
    expect(r.steps).toBe(8)
  })

  test('carries fractional accumulator across frames', () => {
    const a = accumulate(0, 0.008)
    expect(a.steps).toBe(0)
    const b = accumulate(a.accumulator, 0.008)
    expect(b.steps).toBe(1)
  })
})
