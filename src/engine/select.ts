import { createCanvas2DBackend } from '@/backends/canvas2d'
import type { Backend, BackendKind } from '@/types'
import { detectCapabilities, resolveBackendKind } from './backend'

export interface SelectOptions {
  requested: BackendKind
  dotSize: number
}

/**
 * Resolves and constructs the best available backend. In P0 only Canvas2D is
 * implemented; GPU tiers fall back to it. P1/P2 swap the fallback for dynamic
 * import of the WebGL2/WebGPU backends.
 */
export function selectBackend(opts: SelectOptions): Backend {
  const kind = resolveBackendKind(opts.requested, detectCapabilities())
  if (kind !== 'canvas2d') {
    if (typeof console !== 'undefined') {
      console.info(
        `[dotimation] ${kind} backend not yet available, using canvas2d`,
      )
    }
  }
  return createCanvas2DBackend({ dotSize: opts.dotSize })
}
