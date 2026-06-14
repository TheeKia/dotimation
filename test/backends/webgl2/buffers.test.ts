import { describe, expect, test } from 'bun:test'
import { packStateInto, packTargetsInto } from '@/backends/webgl2/buffers'
import { createField } from '@/engine/field'
import type { ParticleField } from '@/types'

function seed(): ParticleField {
  const f = createField(2)
  f.x.set([1, 5], 0)
  f.y.set([2, 6], 0)
  f.vx.set([0, 0], 0)
  f.vy.set([0, 0], 0)
  f.r.set([10, 40], 0)
  f.g.set([20, 50], 0)
  f.b.set([30, 60], 0)
  f.alpha.set([1, 0.5], 0)
  f.homeX.set([1, 5], 0)
  f.homeY.set([2, 6], 0)
  f.homeR.set([10, 40], 0)
  f.homeG.set([20, 50], 0)
  f.homeB.set([30, 60], 0)
  f.targetAlpha.set([1, 0], 0)
  return f
}

describe('packStateInto', () => {
  test('writes interleaved [x,y,vx,vy,r,g,b,alpha] and returns a right-sized view', () => {
    const f = seed()
    const scratch = new Float32Array(64)
    const out = packStateInto(scratch, f, 0, 2)
    expect(out.length).toBe(16) // 2 slots * 8 floats
    expect(Array.from(out)).toEqual([
      1, 2, 0, 0, 10, 20, 30, 1, 5, 6, 0, 0, 40, 50, 60, 0.5,
    ])
    expect(out.buffer).toBe(scratch.buffer) // a view, not a fresh allocation
  })

  test('packs a sub-range [start,end)', () => {
    const f = seed()
    const out = packStateInto(new Float32Array(64), f, 1, 2)
    expect(out.length).toBe(8)
    expect(Array.from(out)).toEqual([5, 6, 0, 0, 40, 50, 60, 0.5])
  })
})

describe('packTargetsInto', () => {
  test('writes interleaved [homeX,homeY,homeR,homeG,homeB,targetAlpha]', () => {
    const f = seed()
    const out = packTargetsInto(new Float32Array(64), f, 2)
    expect(out.length).toBe(12) // 2 slots * 6 floats
    expect(Array.from(out)).toEqual([1, 2, 10, 20, 30, 1, 5, 6, 40, 50, 60, 0])
  })
})
