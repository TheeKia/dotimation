import { describe, expect, test } from 'bun:test'
import { stepField } from '@/backends/canvas2d/simulate'
import { COLOR_RATE, JITTER_AMOUNT } from '@/engine/constants'
import { createField, reconcile } from '@/engine/field'
import { tuneSpring } from '@/engine/settle'
import type { FieldTargets } from '@/types'

function one(x: number, y: number): FieldTargets {
  return {
    count: 1,
    homeX: Float32Array.of(x),
    homeY: Float32Array.of(y),
    homeR: Float32Array.of(200),
    homeG: Float32Array.of(200),
    homeB: Float32Array.of(200),
  }
}

const spring = tuneSpring({ settleTime: 0.85, zeta: 1 })

describe('stepField', () => {
  test('moves a particle toward home and fades it in', () => {
    const f = reconcile(createField(1), one(50, 50))
    f.x[0] = 0
    f.y[0] = 0
    for (let i = 0; i < 200; i++)
      stepField(f, 1 / 90, spring.k, spring.c, () => 0.5)
    expect(f.x[0]).toBeCloseTo(50, 0)
    expect(f.alpha[0]).toBeCloseTo(1, 2)
  })

  test('eases color toward home at COLOR_RATE in a single step', () => {
    const f = reconcile(createField(1), one(0, 0))
    f.r[0] = 0
    f.g[0] = 0
    f.b[0] = 0
    f.alpha[0] = 1
    const dt = 1 / 90
    stepField(f, dt, spring.k, spring.c, () => 0.5)
    // home color is 200 (see `one`); ease factor is 1 - exp(-rate*dt).
    const expected = 200 * (1 - Math.exp(-COLOR_RATE * dt))
    expect(f.r[0]).toBeCloseTo(expected, 5)
    expect(f.g[0]).toBeCloseTo(expected, 5)
    expect(f.b[0]).toBeCloseTo(expected, 5)
  })

  test('applies x-only jitter sourced from rand', () => {
    const f = reconcile(createField(1), one(0, 0))
    // At home with zero velocity the spring contributes nothing, isolating jitter.
    f.x[0] = 0
    f.y[0] = 0
    f.vx[0] = 0
    f.vy[0] = 0
    f.alpha[0] = 1
    // rand=1 → (1 - 0.5) * JITTER_AMOUNT nudge on X, none on Y.
    stepField(f, 1 / 90, spring.k, spring.c, () => 1)
    expect(f.x[0]).toBeCloseTo(0.5 * JITTER_AMOUNT, 5)
    expect(f.y[0]).toBe(0)
  })

  test('compacts a fully faded fader out of count', () => {
    let f = reconcile(createField(1), one(0, 0))
    f.alpha[0] = 1
    f = reconcile(f, { ...one(0, 0), count: 0 }) // shrink to zero actives → slot 0 fades
    expect(f.count).toBe(1)
    for (let i = 0; i < 500; i++)
      stepField(f, 1 / 90, spring.k, spring.c, () => 0.5)
    expect(f.count).toBe(0)
  })
})
