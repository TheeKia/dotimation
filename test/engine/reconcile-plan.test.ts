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

  test('growth drops superseded faders and spawns fresh from the live cluster', () => {
    // 2 live + 3 in-flight faders, growing to 4. The faders belong to an already
    // superseded transition, so they are dropped (not carried into count) and the
    // 2 new actives spawn fresh from the live cluster. count is exactly newActive.
    expect(planReconcile(2, 5, 4)).toEqual({
      active: 4,
      count: 4,
      overlap: 2,
      relocate: null,
      spawn: { start: 2, end: 4 },
      firstLoad: false,
    })
  })

  test('shrink drops superseded faders, only the live surplus fades', () => {
    // 2 live + 3 in-flight faders, shrinking to 1. The new fader is the single
    // live surplus at slot 1; the 3 older faders are dropped, so count is the
    // previous live count (2), never the accumulated 5.
    expect(planReconcile(2, 5, 1)).toEqual({
      active: 1,
      count: 2,
      overlap: 1,
      relocate: null,
      spawn: null,
      firstLoad: false,
    })
  })

  test('regression: A(100)->B(50)->C(80) drops A faders instead of bleeding them into C', () => {
    // The A->B shrink leaves 50 A faders. B->C must drop them and spawn C's new
    // actives from the live B cluster, so no "part of A" survives into B->C.
    expect(planReconcile(50, 100, 80)).toEqual({
      active: 80,
      count: 80,
      overlap: 50,
      relocate: null,
      spawn: { start: 50, end: 80 },
      firstLoad: false,
    })
  })

  test('growth from an empty field seeds fresh actives (faders dropped)', () => {
    // active 0 means the field fully emptied; the dead faders are dropped and the
    // new actives spawn fresh (seeded at home by reconcile when prevActive is 0).
    expect(planReconcile(0, 2, 3)).toEqual({
      active: 3,
      count: 3,
      overlap: 0,
      relocate: null,
      spawn: { start: 0, end: 3 },
      firstLoad: false,
    })
  })
})
