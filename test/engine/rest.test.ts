import { describe, expect, test } from 'bun:test'
import { createField, reconcile } from '@/engine/field'
import { isFieldSettled } from '@/engine/rest'
import type { FieldTargets, ParticleField } from '@/types'

function target(): FieldTargets {
  return {
    count: 1,
    homeX: Float32Array.of(5),
    homeY: Float32Array.of(5),
    homeR: Float32Array.of(100),
    homeG: Float32Array.of(120),
    homeB: Float32Array.of(140),
  }
}

function settled(): ParticleField {
  const f = reconcile(createField(1), target())
  f.x[0] = 5
  f.y[0] = 5
  f.vx[0] = 0
  f.vy[0] = 0
  f.r[0] = 100
  f.g[0] = 120
  f.b[0] = 140
  f.alpha[0] = 1 // targetAlpha is 1 after reconcile
  return f
}

describe('isFieldSettled', () => {
  test('true when velocity, color, and alpha have all converged', () => {
    expect(isFieldSettled(settled())).toBe(true)
  })

  test('false while a particle still has velocity', () => {
    const f = settled()
    f.vx[0] = 5
    expect(isFieldSettled(f)).toBe(false)
  })

  test('false when a particle has not yet moved toward its home (0 velocity, large pos error)', () => {
    const f = settled()
    f.vx[0] = 0
    f.vy[0] = 0
    f.x[0] = 50 // home is 5 → 45px away, but velocity is 0 (first frame, not stepped)
    expect(isFieldSettled(f)).toBe(false)
  })

  test('false while alpha is still fading in', () => {
    const f = settled()
    f.alpha[0] = 0.4
    expect(isFieldSettled(f)).toBe(false)
  })

  test('false while a fader has not finished leaving', () => {
    const f = settled()
    f.count = 1
    f.active = 0
    f.targetAlpha[0] = 0
    f.alpha[0] = 0.5
    expect(isFieldSettled(f)).toBe(false)
  })

  test('false while color is still easing toward home', () => {
    const f = settled()
    f.r[0] = 10 // far from homeR 100
    expect(isFieldSettled(f)).toBe(false)
  })

  test('true for an empty field', () => {
    expect(isFieldSettled(createField(1))).toBe(true)
  })
})
