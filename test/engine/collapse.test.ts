import { describe, expect, test } from 'bun:test'
import { buildTargetGrid, nearestTarget } from '@/engine/collapse'
import type { FieldTargets } from '@/types'

function targets(points: [number, number][]): FieldTargets {
  const n = points.length
  const t: FieldTargets = {
    count: n,
    homeX: new Float32Array(n),
    homeY: new Float32Array(n),
    homeR: new Float32Array(n),
    homeG: new Float32Array(n),
    homeB: new Float32Array(n),
  }
  points.forEach(([x, y], i) => {
    t.homeX[i] = x
    t.homeY[i] = y
  })
  return t
}

function brute(t: FieldTargets, count: number, x: number, y: number): number {
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < count; i++) {
    const dx = t.homeX[i]! - x
    const dy = t.homeY[i]! - y
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

describe('nearestTarget', () => {
  test('returns the index of the dot at the query point', () => {
    const t = targets([
      [0, 0],
      [100, 0],
      [0, 100],
      [100, 100],
    ])
    const g = buildTargetGrid(t, t.count)
    expect(nearestTarget(g, 100, 0)).toBe(1)
    expect(nearestTarget(g, 0, 100)).toBe(2)
  })

  test('picks the closest dot for a point between dots', () => {
    const t = targets([
      [0, 0],
      [100, 0],
    ])
    const g = buildTargetGrid(t, t.count)
    expect(nearestTarget(g, 40, 0)).toBe(0)
    expect(nearestTarget(g, 60, 0)).toBe(1)
  })

  test('handles a query far outside the targets bounding box', () => {
    const t = targets([
      [0, 0],
      [10, 0],
      [10, 10],
    ])
    const g = buildTargetGrid(t, t.count)
    expect(nearestTarget(g, 1000, 1000)).toBe(2) // [10,10] is closest
    expect(nearestTarget(g, -1000, -1000)).toBe(0) // [0,0] is closest
  })

  test('single target is always nearest', () => {
    const t = targets([[7, 7]])
    const g = buildTargetGrid(t, t.count)
    expect(nearestTarget(g, 0, 0)).toBe(0)
    expect(nearestTarget(g, 999, -999)).toBe(0)
  })

  test('matches brute-force nearest for a random cloud (fuzz)', () => {
    let seed = 12345
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const pts: [number, number][] = Array.from(
      { length: 800 },
      () => [rand() * 1000, rand() * 600] as [number, number],
    )
    const t = targets(pts)
    const g = buildTargetGrid(t, t.count)
    for (let q = 0; q < 400; q++) {
      const x = rand() * 1200 - 100
      const y = rand() * 800 - 100
      const got = nearestTarget(g, x, y)
      const want = brute(t, t.count, x, y)
      // Tie-break differences are fine as long as the distance is identical.
      const dGot = (t.homeX[got]! - x) ** 2 + (t.homeY[got]! - y) ** 2
      const dWant = (t.homeX[want]! - x) ** 2 + (t.homeY[want]! - y) ** 2
      expect(dGot).toBeCloseTo(dWant, 4)
    }
  })
})
