import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_DOTS,
  DEFAULT_MOTION,
  MIN_DAMPING,
  MIN_SETTLE_TIME,
  resolveDots,
  resolveMotion,
  toSimParams,
} from '../../src/engine/params'
import { tuneSpring } from '../../src/engine/settle'

describe('resolveDots', () => {
  test('no input yields defaults', () => {
    expect(resolveDots()).toEqual(DEFAULT_DOTS)
    expect(resolveDots({})).toEqual(DEFAULT_DOTS)
  })

  test('partial input keeps other defaults', () => {
    const r = resolveDots({ size: 3 })
    expect(r.size).toBe(3)
    expect(r.spacing).toBe(DEFAULT_DOTS.spacing)
    expect(r.threshold).toBe(DEFAULT_DOTS.threshold)
    expect(r.max).toBe(DEFAULT_DOTS.max)
  })

  test('sanitizes size: non-positive or non-finite falls back to default', () => {
    expect(resolveDots({ size: 0 }).size).toBe(DEFAULT_DOTS.size)
    expect(resolveDots({ size: -2 }).size).toBe(DEFAULT_DOTS.size)
    expect(resolveDots({ size: Number.NaN }).size).toBe(DEFAULT_DOTS.size)
    expect(resolveDots({ size: Number.POSITIVE_INFINITY }).size).toBe(
      DEFAULT_DOTS.size,
    )
  })

  test('clamps spacing to >= 1', () => {
    expect(resolveDots({ spacing: 0.25 }).spacing).toBe(1)
    expect(resolveDots({ spacing: 5 }).spacing).toBe(5)
    expect(resolveDots({ spacing: Number.NaN }).spacing).toBe(
      DEFAULT_DOTS.spacing,
    )
  })

  test('clamps threshold to [0, 255]', () => {
    expect(resolveDots({ threshold: -10 }).threshold).toBe(0)
    expect(resolveDots({ threshold: 300 }).threshold).toBe(255)
    expect(resolveDots({ threshold: Number.NaN }).threshold).toBe(
      DEFAULT_DOTS.threshold,
    )
  })

  test('max: floors, clamps to >= 0, Infinity stays unbounded, NaN defaults', () => {
    expect(resolveDots({ max: 100.9 }).max).toBe(100)
    expect(resolveDots({ max: -5 }).max).toBe(0)
    expect(resolveDots({ max: Number.POSITIVE_INFINITY }).max).toBe(
      Number.POSITIVE_INFINITY,
    )
    expect(resolveDots({ max: Number.NaN }).max).toBe(DEFAULT_DOTS.max)
  })
})

describe('resolveMotion', () => {
  test('no input yields defaults', () => {
    expect(resolveMotion()).toEqual(DEFAULT_MOTION)
    expect(resolveMotion({})).toEqual(DEFAULT_MOTION)
  })

  test('jitter: clamps negatives to 0, non-finite defaults', () => {
    expect(resolveMotion({ jitter: -1 }).jitter).toBe(0)
    expect(resolveMotion({ jitter: 0 }).jitter).toBe(0)
    expect(resolveMotion({ jitter: 2.5 }).jitter).toBe(2.5)
    expect(resolveMotion({ jitter: Number.NaN }).jitter).toBe(
      DEFAULT_MOTION.jitter,
    )
  })

  test('settleTime: floored at MIN_SETTLE_TIME, non-positive defaults', () => {
    expect(resolveMotion({ settleTime: 0.05 }).settleTime).toBe(MIN_SETTLE_TIME)
    expect(resolveMotion({ settleTime: 2 }).settleTime).toBe(2)
    expect(resolveMotion({ settleTime: 0 }).settleTime).toBe(
      DEFAULT_MOTION.settleTime,
    )
    expect(resolveMotion({ settleTime: -1 }).settleTime).toBe(
      DEFAULT_MOTION.settleTime,
    )
  })

  test('damping: clamped to [MIN_DAMPING, 1]', () => {
    expect(resolveMotion({ damping: 0.05 }).damping).toBe(MIN_DAMPING)
    expect(resolveMotion({ damping: 3 }).damping).toBe(1)
    expect(resolveMotion({ damping: 0.5 }).damping).toBe(0.5)
    expect(resolveMotion({ damping: Number.NaN }).damping).toBe(
      DEFAULT_MOTION.damping,
    )
  })

  test('fade: non-positive or non-finite defaults', () => {
    expect(resolveMotion({ fade: 0 }).fade).toBe(DEFAULT_MOTION.fade)
    expect(resolveMotion({ fade: -2 }).fade).toBe(DEFAULT_MOTION.fade)
    expect(resolveMotion({ fade: 4 }).fade).toBe(4)
  })
})

describe('toSimParams', () => {
  test('applies tuneSpring and carries fields through', () => {
    const m = resolveMotion({ settleTime: 0.5, damping: 0.8, fade: 3 })
    const p = toSimParams(m, 2, false)
    const { k, c } = tuneSpring({ settleTime: 0.5, zeta: 0.8 })
    expect(p.k).toBe(k)
    expect(p.c).toBe(c)
    expect(p.dotSize).toBe(2)
    expect(p.jitter).toBe(m.jitter)
    expect(p.settleTime).toBe(0.5)
    expect(p.opacityRate).toBe(3)
    expect(p.colorRate).toBe(2)
  })

  test('reduced motion zeroes jitter but nothing else', () => {
    const p = toSimParams(resolveMotion({ jitter: 5 }), 1, true)
    expect(p.jitter).toBe(0)
    expect(p.opacityRate).toBe(DEFAULT_MOTION.fade)
  })

  test('defaults reproduce the 0.6.0 constants', () => {
    const p = toSimParams(resolveMotion(), 1, false)
    const legacy = tuneSpring({ settleTime: 0.85, zeta: 1 })
    expect(p.k).toBe(legacy.k)
    expect(p.c).toBe(legacy.c)
    expect(p.jitter).toBe(1)
    expect(p.opacityRate).toBe(2)
    expect(p.colorRate).toBe(2)
  })
})
