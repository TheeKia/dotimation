/**
 * CSS-pixel → WebGL clip-space mapping. Positions are in CSS px (as the SoA
 * field stores them); the canvas backing store is `devPx = cssPx * dpr`. These
 * mirror what the render vertex shader computes, kept here so the math is
 * unit-testable without a GL context.
 */
export function cssToClipX(xCss: number, devW: number, dpr: number): number {
  return ((xCss * dpr) / devW) * 2 - 1
}

export function cssToClipY(yCss: number, devH: number, dpr: number): number {
  return 1 - ((yCss * dpr) / devH) * 2
}
