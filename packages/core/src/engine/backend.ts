export interface Capabilities {
  webgpu: boolean
  webgl2: boolean
}

// CPU rasterizers behind WebGL. Their per-instance draw overhead makes the
// WebGL2 tier far slower than Canvas2D, enough to block the main thread.
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|basic render driver/i

export function isSoftwareRenderer(renderer: string): boolean {
  return SOFTWARE_RENDERER.test(renderer)
}

function rendererName(gl: WebGL2RenderingContext): string {
  // Firefox reports a sanitized renderer here and warns when the debug
  // extension is requested; Chrome masks it, so only that placeholder needs
  // the extension.
  const renderer = String(gl.getParameter(gl.RENDERER))
  if (renderer !== 'WebKit WebGL') return renderer
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : renderer
}

/** Detects GPU tiers for auto. DOM-bound; all-false outside a browser. */
export function detectCapabilities(): Capabilities {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') {
    return { webgpu: false, webgl2: false }
  }
  const webgpu = 'gpu' in navigator
  let webgl2 = false
  try {
    const probe = document.createElement('canvas').getContext('webgl2')
    webgl2 = !!probe && !isSoftwareRenderer(rendererName(probe))
    // Release the probe context immediately — browsers cap live WebGL contexts,
    // and a GC'd canvas does not promptly free its context.
    probe?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    webgl2 = false
  }
  return { webgpu, webgl2 }
}
