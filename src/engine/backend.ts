import type { BackendKind } from '@/types'

export interface Capabilities {
  webgpu: boolean
  webgl2: boolean
}

/** Resolves an `'auto'` request (or honors an explicit one) against capabilities. */
export function resolveBackendKind(
  requested: BackendKind,
  caps: Capabilities,
): Exclude<BackendKind, 'auto'> {
  if (requested !== 'auto') return requested
  if (caps.webgpu) return 'webgpu'
  if (caps.webgl2) return 'webgl2'
  return 'canvas2d'
}

/** Detects available GPU tiers. DOM-bound; returns all-false outside a browser. */
export function detectCapabilities(): Capabilities {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') {
    return { webgpu: false, webgl2: false }
  }
  const webgpu = 'gpu' in navigator
  let webgl2 = false
  try {
    webgl2 = !!document.createElement('canvas').getContext('webgl2')
  } catch {
    webgl2 = false
  }
  return { webgpu, webgl2 }
}
