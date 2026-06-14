import { describe, expect, test } from 'bun:test'
import { resolveBackendKind } from '@/engine/backend'

describe('resolveBackendKind', () => {
  test('honors an explicit non-auto choice', () => {
    expect(resolveBackendKind('canvas2d', { webgpu: true, webgl2: true })).toBe(
      'canvas2d',
    )
    expect(resolveBackendKind('webgl2', { webgpu: true, webgl2: true })).toBe(
      'webgl2',
    )
  })

  test('auto prefers webgpu, then webgl2, then canvas2d', () => {
    expect(resolveBackendKind('auto', { webgpu: true, webgl2: true })).toBe(
      'webgpu',
    )
    expect(resolveBackendKind('auto', { webgpu: false, webgl2: true })).toBe(
      'webgl2',
    )
    expect(resolveBackendKind('auto', { webgpu: false, webgl2: false })).toBe(
      'canvas2d',
    )
  })
})
