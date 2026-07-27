import { createCanvas2DBackend } from '@/backends/canvas2d'
import type { Backend, BackendKind } from '@/types'
import { detectCapabilities } from './backend'
import { type ConcreteBackend, resolveBackendOrder } from './cascade'
import type { SimParams } from './params'

export interface SelectOptions {
  requested: BackendKind
  params: SimParams
  canvas: HTMLCanvasElement
  dpr: number
}

async function construct(
  kind: ConcreteBackend,
  params: SimParams,
): Promise<Backend> {
  if (kind === 'webgpu') {
    return (await import('@/backends/webgpu')).createWebGPUBackend(params)
  }
  if (kind === 'webgl2') {
    return (await import('@/backends/webgl2')).createWebGL2Backend(params)
  }
  return createCanvas2DBackend(params)
}

/**
 * Constructs and initializes the best available backend, trying tiers in order
 * (GPU backends are dynamically imported / code-split) and falling through to
 * the next on any construct/init failure. Canvas2D is the always-present last
 * tier; if even it fails (canvas already bound to another context type), this
 * throws rather than returning a dead backend.
 */
export async function selectBackend(
  opts: SelectOptions,
): Promise<{ backend: Backend; kind: ConcreteBackend }> {
  // Only the 'auto' path consults capabilities; an explicit request ignores
  // them (see resolveBackendOrder), so skip the GL probe — and its context
  // allocation — entirely for non-auto requests.
  const caps =
    opts.requested === 'auto'
      ? detectCapabilities()
      : { webgpu: false, webgl2: false }
  const order = resolveBackendOrder(opts.requested, caps)
  for (const kind of order) {
    let be: Backend | undefined
    try {
      be = await construct(kind, opts.params)
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
  // Every tier failed — including Canvas2D, which only happens when the canvas
  // is already bound to a different context type. Surface it; a silent blank
  // canvas is undebuggable.
  throw new Error('dotimation: no rendering backend could initialize')
}
