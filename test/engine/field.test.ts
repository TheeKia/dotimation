import { describe, expect, test } from 'bun:test'
import { createField, growField, nextPow2 } from '@/engine/field'

describe('nextPow2', () => {
  test('rounds up to next power of two', () => {
    expect(nextPow2(1)).toBe(1)
    expect(nextPow2(5)).toBe(8)
    expect(nextPow2(1024)).toBe(1024)
    expect(nextPow2(1025)).toBe(2048)
  })
})

describe('createField', () => {
  test('allocates all arrays at capacity with zero counts', () => {
    const f = createField(10)
    expect(f.capacity).toBe(16)
    expect(f.active).toBe(0)
    expect(f.count).toBe(0)
    expect(f.x.length).toBe(16)
    expect(f.targetAlpha.length).toBe(16)
  })
})

describe('growField', () => {
  test('grows capacity and preserves existing data', () => {
    const f = createField(2)
    f.x[0] = 3.5
    f.active = 1
    f.count = 1
    const g = growField(f, 100)
    expect(g.capacity).toBe(128)
    expect(g.x[0]).toBe(3.5)
    expect(g.active).toBe(1)
    expect(g.count).toBe(1)
  })

  test('returns same field when capacity already sufficient', () => {
    const f = createField(16)
    expect(growField(f, 10)).toBe(f)
  })
})
