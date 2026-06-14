import type { BackendKind } from '@/types'
import type { Capabilities } from './backend'

export type ConcreteBackend = Exclude<BackendKind, 'auto'>

/**
 * Ordered tier list to try, from best to the always-present Canvas2D safety net.
 * `'auto'` yields the supported subset; an explicit GPU choice yields that tier
 * then Canvas2D; `'canvas2d'` yields just Canvas2D.
 */
export function resolveBackendOrder(
  requested: BackendKind,
  caps: Capabilities,
): ConcreteBackend[] {
  if (requested === 'canvas2d') return ['canvas2d']
  if (requested === 'webgpu') return ['webgpu', 'canvas2d']
  if (requested === 'webgl2') return ['webgl2', 'canvas2d']
  const order: ConcreteBackend[] = []
  if (caps.webgpu) order.push('webgpu')
  if (caps.webgl2) order.push('webgl2')
  order.push('canvas2d')
  return order
}
