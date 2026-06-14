import { describe, expect, test } from 'bun:test'
import { planReconcile } from '@/engine/reconcile-plan'

describe('planReconcile', () => {
  test('first load spawns all, no overlap', () => {
    expect(planReconcile(0, 0, 3)).toEqual({
      active: 3,
      count: 3,
      overlap: 0,
      relocate: null,
      spawn: { start: 0, end: 3 },
      firstLoad: true,
    })
  })

  test('shrink keeps actives, fades surplus, no spawn/relocate', () => {
    expect(planReconcile(4, 4, 2)).toEqual({
      active: 2,
      count: 4,
      overlap: 2,
      relocate: null,
      spawn: null,
      firstLoad: false,
    })
  })

  test('growth without faders spawns new actives, no relocate', () => {
    expect(planReconcile(2, 2, 4)).toEqual({
      active: 4,
      count: 4,
      overlap: 2,
      relocate: null,
      spawn: { start: 2, end: 4 },
      firstLoad: false,
    })
  })

  test('growth with in-flight faders relocates them then spawns', () => {
    expect(planReconcile(2, 5, 4)).toEqual({
      active: 4,
      count: 7,
      overlap: 2,
      relocate: { from: 2, to: 4, len: 3 },
      spawn: { start: 2, end: 4 },
      firstLoad: false,
    })
  })
})
