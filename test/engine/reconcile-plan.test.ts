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

  test('growth into in-flight faders revives them in place (no relocate/spawn)', () => {
    // 2 live + 3 faders, growing to 4 active. The 2 new actives are taken from
    // the faders sitting at slots [2,4) by reviving them (retarget handles it),
    // so nothing relocates and nothing spawns. The 1 leftover fader at slot 4
    // keeps fading, so count stays at the previous 5.
    expect(planReconcile(2, 5, 4)).toEqual({
      active: 4,
      count: 5,
      overlap: 2,
      relocate: null,
      spawn: null,
      firstLoad: false,
    })
  })

  test('growth beyond fader supply revives all faders then spawns the rest', () => {
    // 2 live + 1 fader, growing to 5 active. The fader at slot 2 is revived; the
    // remaining 2 new actives [3,5) are spawned beyond the old count of 3.
    expect(planReconcile(2, 3, 5)).toEqual({
      active: 5,
      count: 5,
      overlap: 2,
      relocate: null,
      spawn: { start: 3, end: 5 },
      firstLoad: false,
    })
  })

  test('regression: A(100)->B(50)->C(80) does not relocate A faders into C', () => {
    // The B->C grow must reuse the still-fading A faders rather than relocating
    // them out and spawning fresh, which is what leaked "parts of A" into B->C.
    expect(planReconcile(50, 100, 80)).toEqual({
      active: 80,
      count: 100,
      overlap: 50,
      relocate: null,
      spawn: null,
      firstLoad: false,
    })
  })

  test('growth from an empty field (only faders) still seeds fresh at home', () => {
    // active 0 means the field fully emptied; reviving long-dead faders from
    // stale positions looks like junk, so this case keeps seeding fresh.
    expect(planReconcile(0, 2, 3)).toEqual({
      active: 3,
      count: 5,
      overlap: 0,
      relocate: { from: 0, to: 3, len: 2 },
      spawn: { start: 0, end: 3 },
      firstLoad: false,
    })
  })
})
