export type AnimateItem =
  | { type: 'text'; data: string }
  | { type: 'image'; data: string; maxWidth?: number; maxHeight?: number }

export type Particle = {
  homeX: number
  homeY: number
  x: number
  y: number
  vx: number
  vy: number
  opacity: number
  r: number
  g: number
  b: number
  homeR: number
  homeG: number
  homeB: number
}
