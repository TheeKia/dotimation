export type AnimateItem =
  | {
      type: 'text'
      data: string
      fontFamily?: string
      fontSize?: number | 'AUTO' | 'AUTO_MONO'
      textColor?: string | CanvasGradient | CanvasPattern
    }
  | {
      type: 'image'
      data: string
      maxWidth?: number
      maxHeight?: number
      invert?: boolean
    }

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
