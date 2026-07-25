import { describe, expect, test } from 'bun:test'
import { morton16, spatialOrder } from '@/engine/morton'

describe('morton16', () => {
  test('interleaves bits (x low bit -> bit 0, y low bit -> bit 1)', () => {
    expect(morton16(0, 0)).toBe(0)
    expect(morton16(1, 0)).toBe(1)
    expect(morton16(0, 1)).toBe(2)
    expect(morton16(1, 1)).toBe(3)
    expect(morton16(0b11, 0b11)).toBe(0b1111)
  })

  test('uses the full 16-bit range without sign issues', () => {
    expect(morton16(0xffff, 0xffff)).toBe(0xffffffff)
    expect(morton16(0xffff, 0)).toBe(0x55555555)
    expect(morton16(0, 0xffff)).toBe(0xaaaaaaaa)
  })
})

describe('spatialOrder', () => {
  test('orders spatial neighbors adjacently and is deterministic', () => {
    const xs = [100, 0, 101, 1]
    const ys = [100, 0, 100, 0]
    const order = Array.from(spatialOrder(xs, ys, 4))
    // The two origin-corner points and the two far-corner points end up adjacent.
    expect(order.slice(0, 2).sort()).toEqual([1, 3])
    expect(order.slice(2).sort()).toEqual([0, 2])
  })

  test('breaks Morton-code ties by index for determinism', () => {
    const order = Array.from(spatialOrder([5, 5, 5], [5, 5, 5], 3))
    expect(order).toEqual([0, 1, 2])
  })

  test('rounds fractional coordinates', () => {
    const a = Array.from(spatialOrder([0.4, 10], [0.4, 10], 2))
    const b = Array.from(spatialOrder([0, 10], [0, 10], 2))
    expect(a).toEqual(b)
  })
})
