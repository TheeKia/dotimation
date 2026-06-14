import { describe, expect, test } from 'bun:test'
import { renderField } from '@/backends/canvas2d/render'
import { createField, reconcile } from '@/engine/field'
import type { FieldTargets } from '@/types'

function one(x: number, y: number): FieldTargets {
  return {
    count: 1,
    homeX: Float32Array.of(x),
    homeY: Float32Array.of(y),
    homeR: Float32Array.of(255),
    homeG: Float32Array.of(0),
    homeB: Float32Array.of(0),
  }
}

describe('renderField', () => {
  test('writes an opaque red pixel at the particle position', () => {
    const f = reconcile(createField(1), one(2, 3))
    f.x[0] = 2
    f.y[0] = 3
    f.r[0] = 255
    f.g[0] = 0
    f.b[0] = 0
    f.alpha[0] = 1
    const view = new Uint32Array(8 * 8)
    renderField(view, f, 8, 8, 1, 1)
    expect(view[3 * 8 + 2]).not.toBe(0)
    expect(view.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0)).toBe(1)
  })

  test('skips fully transparent particles', () => {
    const f = reconcile(createField(1), one(2, 3))
    f.alpha[0] = 0
    const view = new Uint32Array(8 * 8)
    renderField(view, f, 8, 8, 1, 1)
    expect(view.every((v) => v === 0)).toBe(true)
  })

  test('dotSize 2 writes a 2x2 footprint', () => {
    const f = reconcile(createField(1), one(2, 2))
    f.x[0] = 2
    f.y[0] = 2
    f.alpha[0] = 1
    const view = new Uint32Array(8 * 8)
    renderField(view, f, 8, 8, 1, 2)
    expect(view.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0)).toBe(4)
  })
})
