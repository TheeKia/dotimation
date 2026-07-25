import type { BackendKind } from '@/types'
import type { Capabilities } from './backend'

export type ConcreteBackend = Exclude<BackendKind, 'auto'>

/**
 * Ordered tier list to try, from the requested starting tier down to the
 * always-present Canvas2D safety net. An explicit request pins the STARTING
 * tier (capabilities are not consulted — construct/init failure is the probe);
 * everything below it stays available as fallback, so `'webgpu'` on a machine
 * without WebGPU still gets WebGL2 rather than dropping straight to software.
 */
export function resolveBackendOrder(
  requested: BackendKind,
  caps: Capabilities,
): ConcreteBackend[] {
  if (requested === 'canvas2d') return ['canvas2d']
  if (requested === 'webgpu') return ['webgpu', 'webgl2', 'canvas2d']
  if (requested === 'webgl2') return ['webgl2', 'canvas2d']
  const order: ConcreteBackend[] = []
  if (caps.webgpu) order.push('webgpu')
  if (caps.webgl2) order.push('webgl2')
  order.push('canvas2d')
  return order
}
