/** Device pixel ratio, capped at `max` (default 2). 1 outside a browser. */
export function getDpr(max = 2): number {
  if (typeof window === 'undefined') return 1
  return Math.min(window.devicePixelRatio || 1, max)
}

/**
 * Sizes a canvas's drawing buffer to device pixels and its CSS box to logical
 * pixels, WITHOUT acquiring a rendering context — so the caller's backend is
 * free to take either a '2d' or 'webgl2' context. Idempotent: setting
 * canvas.width to even the SAME value clears the canvas, so every assignment
 * is guarded. Returns the dpr used.
 */
export function sizeCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  dpr: number = getDpr(),
): number {
  const devW = Math.round(width * dpr)
  const devH = Math.round(height * dpr)
  if (canvas.width !== devW) canvas.width = devW
  if (canvas.height !== devH) canvas.height = devH
  const cssW = `${width}px`
  const cssH = `${height}px`
  if (canvas.style.width !== cssW) canvas.style.width = cssW
  if (canvas.style.height !== cssH) canvas.style.height = cssH
  return dpr
}

export function getCtx(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  dpr: number = getDpr(),
): CanvasRenderingContext2D | null {
  sizeCanvas(canvas, width, height, dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = false
  return ctx
}
