import { describe, expect, test } from 'bun:test'
import { stepField } from '@/backends/canvas2d/simulate'
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
