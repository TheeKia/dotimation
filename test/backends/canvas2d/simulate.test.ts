import { describe, expect, test } from 'bun:test'
import { stepField } from '@/backends/canvas2d/simulate'
import { FIXED_DT } from '@/engine/clock'
import { createField, reconcile } from '@/engine/field'
import { MIN_DAMPING, MIN_SETTLE_TIME } from '@/engine/params'
import { isFieldSettled } from '@/engine/rest'
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
const COLOR_RATE = 2
const JITTER_AMOUNT = 1

describe('stepField', () => {
  test('moves a particle toward home and fades it in', () => {
    const f = reconcile(createField(1), one(50, 50))
    f.x[0] = 0
    f.y[0] = 0
    const p = {
      k: spring.k,
      c: spring.c,
      jitter: 1,
      opacityRate: 2,
      colorRate: 2,
    }
    for (let i = 0; i < 200; i++) stepField(f, 1 / 90, p, () => 0.5)
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
    const p = {
      k: spring.k,
      c: spring.c,
      jitter: 1,
      opacityRate: 2,
      colorRate: 2,
    }
    stepField(f, dt, p, () => 0.5)
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
    const p = {
      k: spring.k,
      c: spring.c,
      jitter: JITTER_AMOUNT,
      opacityRate: 2,
      colorRate: 2,
    }
    stepField(f, 1 / 90, p, () => 1)
    expect(f.x[0]).toBeCloseTo(0.5 * JITTER_AMOUNT, 5)
    expect(f.y[0]).toBe(0)
  })

  test('compacts a fully faded fader out of count', () => {
    let f = reconcile(createField(1), one(0, 0))
    f.alpha[0] = 1
    f = reconcile(f, { ...one(0, 0), count: 0 }) // shrink to zero actives → slot 0 fades
    expect(f.count).toBe(1)
    const p = {
      k: spring.k,
      c: spring.c,
      jitter: 1,
      opacityRate: 2,
      colorRate: 2,
    }
    for (let i = 0; i < 500; i++) stepField(f, 1 / 90, p, () => 0.5)
    expect(f.count).toBe(0)
  })
})

describe('stepField settled reporting', () => {
  test('reports unsettled in flight, settled at rest, matching isFieldSettled', () => {
    const f = reconcile(createField(4), one(100, 40))
    f.x[0] = 0
    f.y[0] = 0
    const p = {
      k: spring.k,
      c: spring.c,
      jitter: 1,
      opacityRate: 2,
      colorRate: 2,
    }
    // rand=0.5 → zero jitter, so the report is deterministic.
    let reported = stepField(f, 1 / 90, p, () => 0.5)
    expect(reported).toBe(false)
    expect(isFieldSettled(f)).toBe(false)
    for (let i = 0; i < 90 * 5; i++) {
      reported = stepField(f, 1 / 90, p, () => 0.5)
    }
    expect(reported).toBe(true)
    expect(isFieldSettled(f)).toBe(true)
  })

  test('reports settled for an empty field', () => {
    const f = createField(1)
    const p = {
      k: spring.k,
      c: spring.c,
      jitter: 1,
      opacityRate: 2,
      colorRate: 2,
    }
    expect(stepField(f, 1 / 90, p, () => 0.5)).toBe(true)
  })
})

describe('stepField stability and rates', () => {
  test('remains finite and converges at the stability floors', () => {
    const field = createField(4)
    field.active = 4
    field.count = 4
    for (let i = 0; i < 4; i++) {
      field.x[i] = 500
      field.y[i] = 500
      field.homeX[i] = i * 10
      field.homeY[i] = i * 5
      field.targetAlpha[i] = 1
    }
    const { k, c } = tuneSpring({
      settleTime: MIN_SETTLE_TIME,
      zeta: MIN_DAMPING,
    })
    const p = { k, c, jitter: 1, opacityRate: 2, colorRate: 2 }
    const rand = () => 0.5 // deterministic: zero jitter offset
    for (let s = 0; s < 5000; s++) stepField(field, FIXED_DT, p, rand)
    for (let i = 0; i < 4; i++) {
      expect(Number.isFinite(field.x[i]!)).toBe(true)
      expect(Number.isFinite(field.vx[i]!)).toBe(true)
      expect(Math.abs(field.x[i]! - field.homeX[i]!)).toBeLessThan(1)
      expect(Math.abs(field.y[i]! - field.homeY[i]!)).toBeLessThan(1)
    }
  })

  test('opacityRate controls fade-in speed', () => {
    const field = createField(1)
    field.active = 1
    field.count = 1
    field.targetAlpha[0] = 1
    field.alpha[0] = 0
    const { k, c } = tuneSpring({ settleTime: 0.85, zeta: 1 })
    const p = { k, c, jitter: 0, opacityRate: 4, colorRate: 2 }
    // alpha rises by opacityRate*dt per step: reaches 1 after 1/4 s
    const steps = Math.ceil(0.25 / FIXED_DT) + 1
    for (let s = 0; s < steps; s++) stepField(field, FIXED_DT, p, () => 0.5)
    expect(field.alpha[0]!).toBe(1)
  })
})
