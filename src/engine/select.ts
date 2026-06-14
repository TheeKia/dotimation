import { createCanvas2DBackend } from '@/backends/canvas2d'
import type { Backend, BackendKind } from '@/types'
import { detectCapabilities, resolveBackendKind } from './backend'

export interface SelectOptions {
  requested: BackendKind
  dotSize: number
}

/**
 * Resolves and constructs the best available backend, loading GPU backends via
 * dynamic import so they stay out of the core bundle. Any failure falls back to
 * Canvas2D (always present).
 */
export async function selectBackend(opts: SelectOptions): Promise<Backend> {
  const kind = resolveBackendKind(opts.requested, detectCapabilities())
  if (kind === 'webgl2') {
    try {
      const mod = await import('@/backends/webgl2')
      return mod.createWebGL2Backend({ dotSize: opts.dotSize })
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.info(
          '[dotimation] webgl2 backend failed to load, using canvas2d',
          err,
        )
      }
    }
  }
  if (kind === 'webgpu' && typeof console !== 'undefined') {
    console.info(
      '[dotimation] webgpu backend not yet available, using canvas2d',
    )
  }
  return createCanvas2DBackend({ dotSize: opts.dotSize })
}
