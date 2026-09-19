import { describe, expect, test } from 'bun:test'
import { computeSettleDuration, tuneSpring } from '../../src/engine/settle'

describe('tuneSpring', () => {
  test('critically damped (zeta 1) gives c^2 == 4k', () => {
    const { k, c } = tuneSpring({ settleTime: 0.85, zeta: 1 })
    expect(c * c).toBeCloseTo(4 * k, 5)
  })
})

describe('computeSettleDuration', () => {
  test('covers spring, opacity, and worst-case color convergence', () => {
    const d = computeSettleDuration(0.85, 2, 2)
    expect(d).toBeGreaterThanOrEqual(0.85)
    expect(255 * Math.exp(-2 * d)).toBeLessThan(0.5)
    expect(d).toBeLessThan(4)
  })
})
