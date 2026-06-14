import { createCanvas2DBackend } from '@/backends/canvas2d'
import type { Backend, BackendKind } from '@/types'
import { detectCapabilities } from './backend'
import { type ConcreteBackend, resolveBackendOrder } from './cascade'

export interface SelectOptions {
  requested: BackendKind
  dotSize: number
  canvas: HTMLCanvasElement
  dpr: number
}

async function construct(
  kind: ConcreteBackend,
  dotSize: number,
): Promise<Backend> {
  if (kind === 'webgpu') {
    return (await import('@/backends/webgpu')).createWebGPUBackend({ dotSize })
  }
  if (kind === 'webgl2') {
    return (await import('@/backends/webgl2')).createWebGL2Backend({ dotSize })
  }
  return createCanvas2DBackend({ dotSize })
}

/**
 * Constructs and initializes the best available backend, trying tiers in order
 * (GPU backends are dynamically imported / code-split) and falling through to
 * the next on any construct/init failure. Canvas2D is the always-present last
 * tier and is assumed not to throw.
 */
export async function selectBackend(
  opts: SelectOptions,
): Promise<{ backend: Backend; kind: ConcreteBackend }> {
  const order = resolveBackendOrder(opts.requested, detectCapabilities())
  for (const kind of order) {
    let be: Backend | undefined
    try {
      be = await construct(kind, opts.dotSize)
      await be.init(opts.canvas, opts.dpr)
      return { backend: be, kind }
    } catch (err) {
      // Dispose any partially-initialized backend before trying the next tier.
      be?.dispose()
      if (typeof console !== 'undefined') {
        console.info(
          `[dotimation] ${kind} backend unavailable, trying next`,
          err,
        )
      }
    }
  }
  const be = createCanvas2DBackend({ dotSize: opts.dotSize })
  await be.init(opts.canvas, opts.dpr)
  return { backend: be, kind: 'canvas2d' }
}
