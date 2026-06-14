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
    const probe = document.createElement('canvas').getContext('webgl2')
    webgl2 = !!probe
    // Release the probe context immediately — browsers cap live WebGL contexts,
    // and a GC'd canvas does not promptly free its context.
    probe?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    webgl2 = false
  }
  return { webgpu, webgl2 }
}
