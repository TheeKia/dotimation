import { describe, expect, test } from 'bun:test'
import { createField, reconcile } from '@/engine/field'
import type { FieldTargets } from '@/types'

function targets(positions: [number, number][]): FieldTargets {
  const n = positions.length
  const t: FieldTargets = {
    count: n,
    homeX: new Float32Array(n),
    homeY: new Float32Array(n),
    homeR: new Float32Array(n),
    homeG: new Float32Array(n),
    homeB: new Float32Array(n),
  }
  positions.forEach(([x, y], i) => {
    t.homeX[i] = x
    t.homeY[i] = y
    t.homeR[i] = 10
    t.homeG[i] = 20
    t.homeB[i] = 30
  })
  return t
}

// Like `targets` but with per-dot colors, so collapse tests can assert that a
// fader adopts the color of the surviving dot it merges into.
function coloredTargets(
  rows: { x: number; y: number; r: number }[],
): FieldTargets {
  const n = rows.length
  const t: FieldTargets = {
    count: n,
    homeX: new Float32Array(n),
    homeY: new Float32Array(n),
    homeR: new Float32Array(n),
    homeG: new Float32Array(n),
    homeB: new Float32Array(n),
  }
  rows.forEach(({ x, y, r }, i) => {
    t.homeX[i] = x
    t.homeY[i] = y
    t.homeR[i] = r
    t.homeG[i] = r
    t.homeB[i] = r
  })
  return t
}

describe('reconcile — shrink collapses surplus toward survivors', () => {
  test('retargets each fader home+color to its nearest surviving dot', () => {
    // A: 10 dots along x = 0,10,...,90. B: 2 dots at x=0 and x=90.
    let f = reconcile(
      createField(1),
      targets(Array.from({ length: 10 }, (_, i) => [i * 10, 0])),
    )
    f = reconcile(
      f,
      coloredTargets([
        { x: 0, y: 0, r: 100 }, // survivor 0 (left)
        { x: 90, y: 0, r: 200 }, // survivor 1 (right)
      ]),
    )

    expect(f.active).toBe(2)
    // Faders are slots [2,10); their old homes were x = 20..90.
    // Left half collapses to the x=0 survivor, right half to the x=90 survivor.
    expect(f.targetAlpha[2]).toBe(0)
    expect(f.homeX[2]).toBe(0) // old x=20 -> nearest survivor x=0
    expect(f.homeR[2]).toBe(100) // adopts that survivor's color
    expect(f.homeX[9]).toBe(90) // old x=90 -> nearest survivor x=90
    expect(f.homeR[9]).toBe(200)
  })

  test('a fader no longer keeps its own old home (it moves)', () => {
    let f = reconcile(
      createField(1),
      targets([
        [0, 0],
        [1000, 1000], // far-away dot that will become a fader
      ]),
    )
    f = reconcile(f, targets([[0, 0]])) // shrink to a single dot at origin
    // Slot 1 faded; instead of staying at (1000,1000) it heads for the survivor.
    expect(f.targetAlpha[1]).toBe(0)
    expect(f.homeX[1]).toBe(0)
    expect(f.homeY[1]).toBe(0)
  })

  test('empty new image leaves faders fading in place (nothing to collapse to)', () => {
    let f = reconcile(
      createField(1),
      targets([
        [5, 5],
        [6, 6],
      ]),
    )
    f = reconcile(f, { ...targets([]), count: 0 })
    expect(f.active).toBe(0)
    // No survivors to move toward, so homes are untouched (fade in place).
    expect(f.homeX[0]).toBe(5)
    expect(f.homeX[1]).toBe(6)
    expect(f.targetAlpha[0]).toBe(0)
  })
})

describe('reconcile — GPU-tier parity (morph from home, not live position)', () => {
  test('growth spawns at the source slot pre-retarget home, not its live x/y', () => {
    let f = reconcile(
      createField(1),
      targets([
        [0, 0],
        [10, 10],
      ]),
    )
    // Simulate a GPU tier: the CPU x/y went stale (the sim runs on the GPU).
    f.x[0] = 12345
    f.y[0] = 12345
    f = reconcile(
      f,
      targets([
        [5, 5],
        [6, 6],
        [7, 7],
        [8, 8],
      ]),
    )
    // Slot 2 spawns from source slot 0: at its (old-layout) home (0,0), not
    // at the stale live position 12345.
    expect(f.x[2]).toBe(0)
    expect(f.y[2]).toBe(0)
    expect(f.alpha[2]).toBe(0)
    expect(f.homeX[2]).toBe(7) // retargeted to the new layout afterwards
  })

  test('shrink matches faders to survivors by home, not stale live position', () => {
    let f = reconcile(
      createField(1),
      coloredTargets([
        { x: 0, y: 0, r: 1 },
        { x: 50, y: 0, r: 1 },
        { x: 100, y: 0, r: 2 }, // will become the fader
      ]),
    )
    f.x[2] = 1 // stale live position near the LEFT survivor
    f.y[2] = 0
    f = reconcile(
      f,
      coloredTargets([
        { x: 0, y: 0, r: 10 },
        { x: 90, y: 0, r: 20 },
      ]),
    )
    expect(f.active).toBe(2)
    expect(f.homeX[2]).toBe(90) // matched by old HOME (100), not stale x (1)
    expect(f.homeR[2]).toBe(20)
  })
})

describe('reconcile — first load', () => {
  test('places actives at home with alpha 0, targetAlpha 1', () => {
    const f = reconcile(
      createField(1),
      targets([
        [5, 6],
        [7, 8],
      ]),
    )
    expect(f.active).toBe(2)
    expect(f.count).toBe(2)
    expect(f.x[0]).toBe(5)
    expect(f.y[0]).toBe(6)
    expect(f.homeX[1]).toBe(7)
    expect(f.alpha[0]).toBe(0)
    expect(f.targetAlpha[0]).toBe(1)
    expect(f.vx[0]).toBe(0)
  })
})

describe('reconcile — shrink', () => {
  test('keeps actives, fades surplus, count unchanged', () => {
    let f = reconcile(
      createField(1),
      targets([
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
      ]),
    )
    f = reconcile(
      f,
      targets([
        [9, 9],
        [8, 8],
      ]),
    )
    expect(f.active).toBe(2)
    expect(f.count).toBe(4)
    expect(f.homeX[0]).toBe(9)
    expect(f.targetAlpha[0]).toBe(1)
    expect(f.targetAlpha[2]).toBe(0)
    expect(f.targetAlpha[3]).toBe(0)
  })
})

describe('reconcile — growth', () => {
  test('seeds new actives from existing and retargets', () => {
    let f = reconcile(
      createField(1),
      targets([
        [0, 0],
        [1, 1],
      ]),
    )
    f.x[0] = 100
    f.y[0] = 200
    f = reconcile(
      f,
      targets([
        [5, 5],
        [6, 6],
        [7, 7],
        [8, 8],
      ]),
    )
    expect(f.active).toBe(4)
    expect(f.count).toBe(4)
    expect([f.x[2]]).toContainEqual(expect.any(Number))
    expect(f.homeX[2]).toBe(7)
    expect(f.targetAlpha[3]).toBe(1)
  })

  test('grows capacity when targets exceed it', () => {
    const f = reconcile(
      createField(2),
      targets(Array.from({ length: 50 }, (_, i) => [i, i] as [number, number])),
    )
    expect(f.capacity).toBeGreaterThanOrEqual(50)
    expect(f.active).toBe(50)
  })

  test('seeds new actives at home when field held only faders (no NaN)', () => {
    // active 0 / count > 0 is reachable: rasterize to zero, then back to N.
    let f = reconcile(
      createField(1),
      targets([
        [1, 1],
        [2, 2],
      ]),
    )
    f = reconcile(f, { ...targets([]), count: 0 }) // all fade out → active 0
    expect(f.active).toBe(0)
    expect(f.count).toBe(2)
    f = reconcile(
      f,
      targets([
        [5, 5],
        [6, 6],
        [7, 7],
      ]),
    ) // growth from active 0
    expect(f.active).toBe(3)
    expect(Number.isFinite(f.x[0]!)).toBe(true)
    expect(f.x[0]).toBe(5) // seeded at home
    expect(f.homeX[2]).toBe(7)
    expect(f.alpha[0]).toBe(0)
    expect(f.targetAlpha[0]).toBe(1)
  })
})

describe('reconcile spatial matching', () => {
  test('pairs each particle with its nearby target instead of by index', () => {
    // Same two positions, listed in REVERSED order in the new targets. Index
    // matching would send both particles across the canvas; spatial matching
    // keeps each at its own position (zero travel).
    let f = reconcile(
      createField(2),
      targets([
        [0, 0],
        [500, 500],
      ]),
    )
    f = reconcile(
      f,
      targets([
        [500, 500],
        [0, 0],
      ]),
      { matching: 'spatial' },
    )
    expect([f.homeX[0], f.homeY[0]]).toEqual([0, 0])
    expect([f.homeX[1], f.homeY[1]]).toEqual([500, 500])
    expect(f.active).toBe(2)
  })

  test('index matching (the default) is unchanged', () => {
    let f = reconcile(
      createField(2),
      targets([
        [0, 0],
        [500, 500],
      ]),
    )
    f = reconcile(
      f,
      targets([
        [500, 500],
        [0, 0],
      ]),
    )
    expect([f.homeX[0], f.homeY[0]]).toEqual([500, 500])
    expect([f.homeX[1], f.homeY[1]]).toEqual([0, 0])
  })

  test('spatial growth orders spawn slots by their spawn position', () => {
    // One particle at the origin grows to three targets. Every slot must end
    // with targetAlpha 1 and each target claimed exactly once.
    let f = reconcile(createField(4), targets([[0, 0]]))
    f = reconcile(
      f,
      targets([
        [0, 0],
        [100, 100],
        [200, 200],
      ]),
      {
        matching: 'spatial',
      },
    )
    expect(f.active).toBe(3)
    const homes = [0, 1, 2].map((i) => `${f.homeX[i]},${f.homeY[i]}`).sort()
    expect(homes).toEqual(['0,0', '100,100', '200,200'])
    for (let i = 0; i < 3; i++) expect(f.targetAlpha[i]).toBe(1)
  })
})
