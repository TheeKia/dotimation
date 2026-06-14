import { describe, expect, test } from 'bun:test'
import {
  computeDirtyRect,
  renderField,
  unionRect,
} from '@/backends/canvas2d/render'
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

  test('dotSize 1 packs exact RGBA bytes at the pixel', () => {
    const f = reconcile(createField(1), one(2, 3))
    f.x[0] = 2
    f.y[0] = 3
    f.r[0] = 10
    f.g[0] = 20
    f.b[0] = 30
    f.alpha[0] = 1
    // Back the view with an ArrayBuffer so we can read it byte-wise. pack()
    // always lays bytes out R,G,B,A in memory regardless of endianness, so the
    // byte-level assertion is portable across CI platforms.
    const buf = new ArrayBuffer(8 * 8 * 4)
    const view = new Uint32Array(buf)
    renderField(view, f, 8, 8, 1, 1)
    const bytes = new Uint8Array(buf)
    const px = (3 * 8 + 2) * 4
    expect(bytes[px]).toBe(10)
    expect(bytes[px + 1]).toBe(20)
    expect(bytes[px + 2]).toBe(30)
    expect(bytes[px + 3]).toBe(255)
  })

  test('dotSize 1 composites two particles at the same pixel', () => {
    const targets: FieldTargets = {
      count: 2,
      homeX: Float32Array.of(2, 2),
      homeY: Float32Array.of(2, 2),
      homeR: Float32Array.of(0, 0),
      homeG: Float32Array.of(0, 0),
      homeB: Float32Array.of(0, 0),
    }
    const f = reconcile(createField(2), targets)
    f.x[0] = 2
    f.y[0] = 2
    f.r[0] = 0
    f.g[0] = 0
    f.b[0] = 255
    f.alpha[0] = 0.5
    f.x[1] = 2
    f.y[1] = 2
    f.r[1] = 255
    f.g[1] = 0
    f.b[1] = 0
    f.alpha[1] = 0.5
    const buf = new ArrayBuffer(8 * 8 * 4)
    const view = new Uint32Array(buf)
    renderField(view, f, 8, 8, 1, 1)
    const bytes = new Uint8Array(buf)
    const px = (2 * 8 + 2) * 4
    // Exactly one pixel touched, and it blends both dots (red over blue).
    expect(view.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0)).toBe(1)
    expect(bytes[px]!).toBeGreaterThan(0) // red contribution
    expect(bytes[px + 2]!).toBeGreaterThan(0) // blue contribution
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

describe('computeDirtyRect', () => {
  test('tight box around a single dot at dotSize 1', () => {
    const f = reconcile(createField(1), one(2, 3))
    f.x[0] = 2
    f.y[0] = 3
    f.alpha[0] = 1
    expect(computeDirtyRect(f, 8, 8, 1, 1)).toEqual({ x: 2, y: 3, w: 1, h: 1 })
  })

  test('expands by the footprint for dotSize 2', () => {
    const f = reconcile(createField(1), one(2, 3))
    f.x[0] = 2
    f.y[0] = 3
    f.alpha[0] = 1
    expect(computeDirtyRect(f, 8, 8, 1, 2)).toEqual({ x: 2, y: 3, w: 2, h: 2 })
  })

  test('null when nothing is visible', () => {
    const f = reconcile(createField(1), one(2, 3))
    f.alpha[0] = 0
    expect(computeDirtyRect(f, 8, 8, 1, 1)).toBeNull()
  })

  test('clamps to the canvas bounds', () => {
    const f = reconcile(createField(1), one(7, 7))
    f.x[0] = 7
    f.y[0] = 7
    f.alpha[0] = 1
    expect(computeDirtyRect(f, 8, 8, 1, 4)).toEqual({ x: 7, y: 7, w: 1, h: 1 })
  })
})

describe('unionRect', () => {
  test('covers both rects', () => {
    expect(
      unionRect({ x: 0, y: 0, w: 1, h: 1 }, { x: 3, y: 3, w: 1, h: 1 }),
    ).toEqual({ x: 0, y: 0, w: 4, h: 4 })
  })
  test('returns the non-null side', () => {
    expect(unionRect(null, { x: 2, y: 2, w: 1, h: 1 })).toEqual({
      x: 2,
      y: 2,
      w: 1,
      h: 1,
    })
    expect(unionRect({ x: 2, y: 2, w: 1, h: 1 }, null)).toEqual({
      x: 2,
      y: 2,
      w: 1,
      h: 1,
    })
    expect(unionRect(null, null)).toBeNull()
  })
})

describe('renderField scoped clear', () => {
  test('with a clearRect, pixels outside the rect are left untouched', () => {
    const f = reconcile(createField(1), one(2, 2))
    f.x[0] = 2
    f.y[0] = 2
    f.alpha[0] = 1
    const view = new Uint32Array(8 * 8).fill(0xdeadbeef)
    renderField(view, f, 8, 8, 1, 1, { x: 1, y: 1, w: 3, h: 3 })
    expect(view[0]).toBe(0xdeadbeef)
    expect(view[7 * 8 + 7]).toBe(0xdeadbeef)
    expect(view[2 * 8 + 2]).not.toBe(0xdeadbeef)
    expect(view[2 * 8 + 2]).not.toBe(0)
  })

  test('without a clearRect, the whole buffer is cleared (back-compat)', () => {
    const f = reconcile(createField(1), one(2, 2))
    f.x[0] = 2
    f.y[0] = 2
    f.alpha[0] = 1
    const view = new Uint32Array(8 * 8).fill(0xdeadbeef)
    renderField(view, f, 8, 8, 1, 1)
    expect(view[0]).toBe(0)
  })
})
