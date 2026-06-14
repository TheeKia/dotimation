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
})
