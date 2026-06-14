import { describe, expect, test } from 'bun:test'
import { resolveBackendOrder } from '@/engine/cascade'

describe('resolveBackendOrder', () => {
  test('auto returns supported tiers high-to-low, canvas2d always last', () => {
    expect(resolveBackendOrder('auto', { webgpu: true, webgl2: true })).toEqual(
      ['webgpu', 'webgl2', 'canvas2d'],
    )
    expect(
      resolveBackendOrder('auto', { webgpu: false, webgl2: true }),
    ).toEqual(['webgl2', 'canvas2d'])
    expect(
      resolveBackendOrder('auto', { webgpu: false, webgl2: false }),
    ).toEqual(['canvas2d'])
  })

  test('explicit GPU choice falls back only to canvas2d safety net', () => {
    expect(
      resolveBackendOrder('webgpu', { webgpu: true, webgl2: true }),
    ).toEqual(['webgpu', 'canvas2d'])
    expect(
      resolveBackendOrder('webgl2', { webgpu: true, webgl2: true }),
    ).toEqual(['webgl2', 'canvas2d'])
  })

  test('explicit canvas2d is the only tier', () => {
    expect(
      resolveBackendOrder('canvas2d', { webgpu: true, webgl2: true }),
    ).toEqual(['canvas2d'])
  })
})
