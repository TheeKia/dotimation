import { describe, expect, test } from 'bun:test'
import { isWorkerSafe } from '@/raster/worker-safe'
import type { AnimateItem } from '@/types'

const img: AnimateItem = { type: 'image', data: 'x.png' }
const txt = (fontFamily?: string): AnimateItem => ({
  type: 'text',
  data: 'hi',
  fontFamily,
})

describe('isWorkerSafe', () => {
  test('images are always worker-safe', () => {
    expect(isWorkerSafe(img, 'sans-serif')).toBe(true)
  })
  test('generic font families are worker-safe', () => {
    expect(isWorkerSafe(txt('monospace'), 'sans-serif')).toBe(true)
    expect(isWorkerSafe(txt('system-ui'), 'sans-serif')).toBe(true)
    expect(isWorkerSafe(txt(undefined), 'serif')).toBe(true)
  })
  test('custom font families are NOT worker-safe (kept on main thread)', () => {
    expect(isWorkerSafe(txt('Inter'), 'sans-serif')).toBe(false)
    expect(isWorkerSafe(txt('"My Font"'), 'sans-serif')).toBe(false)
  })
})
