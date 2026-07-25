import { describe, expect, test } from 'bun:test'
import { createField, growField, nextPow2, snapField } from '@/engine/field'
import { isFieldSettled } from '@/engine/rest'

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

describe('snapField', () => {
  test('completes the morph instantly and drops faded faders', () => {
    const f = createField(4)
    f.active = 1
    f.count = 2
    // live slot mid-flight
    f.x[0] = 5
    f.y[0] = 5
    f.vx[0] = 40
    f.homeX[0] = 20
    f.homeY[0] = 30
    f.homeR[0] = 200
    f.alpha[0] = 0.3
    f.targetAlpha[0] = 1
    // fader mid-fade
    f.alpha[1] = 0.5
    f.targetAlpha[1] = 0
    snapField(f)
    expect(f.x[0]).toBe(20)
    expect(f.y[0]).toBe(30)
    expect(f.vx[0]).toBe(0)
    expect(f.r[0]).toBe(200)
    expect(f.alpha[0]).toBe(1)
    expect(f.count).toBe(1)
    expect(isFieldSettled(f)).toBe(true)
  })
})
