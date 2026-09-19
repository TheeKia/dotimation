import { createCanvas2DBackend } from '../backends/canvas2d'
import type { Backend, BackendKind } from '../types'
import { detectCapabilities } from './backend'
import { type ConcreteBackend, resolveBackendOrder } from './cascade'
import type { SimParams } from './params'

export interface SelectOptions {
  requested: BackendKind
  params: SimParams
  canvas: HTMLCanvasElement
  dpr: number
  signal?: AbortSignal
}

/** A failed init may have permanently bound the canvas to its context type. */
export class BackendRetryError extends Error {
  readonly next: ConcreteBackend

  constructor(next: ConcreteBackend, options: ErrorOptions) {
    super(`dotimation: retry ${next} on a fresh canvas`, options)
    this.next = next
  }
}

async function construct(
  kind: ConcreteBackend,
  params: SimParams,
): Promise<Backend> {
  if (kind === 'webgpu') {
    return (await import('../backends/webgpu')).createWebGPUBackend(params)
  }
  if (kind === 'webgl2') {
    return (await import('../backends/webgl2')).createWebGL2Backend(params)
  }
  return createCanvas2DBackend(params)
}

/**
 * Initializes the first available tier. A failed init can lock the canvas's
 * context type, so the caller must catch BackendRetryError and remount a fresh
 * canvas before requesting the next tier. Cancellation never triggers fallback.
 */
export async function selectBackend(
  opts: SelectOptions,
): Promise<{ backend: Backend; kind: ConcreteBackend }> {
  const caps =
    opts.requested === 'auto'
      ? detectCapabilities()
      : { webgpu: false, webgl2: false }
  const [kind = 'canvas2d', next] = resolveBackendOrder(opts.requested, caps)
  let be: Backend | undefined
  try {
    opts.signal?.throwIfAborted()
    be = await construct(kind, opts.params)
    opts.signal?.throwIfAborted()
    await be.init(opts.canvas, opts.dpr, opts.signal)
    opts.signal?.throwIfAborted()
    return { backend: be, kind }
  } catch (cause) {
    be?.dispose()
    opts.signal?.throwIfAborted()
    if (next) throw new BackendRetryError(next, { cause })
    throw new Error('dotimation: no rendering backend could initialize', {
      cause,
    })
  }
}
