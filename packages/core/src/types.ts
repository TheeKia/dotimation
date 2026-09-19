export type { DotOptions, MotionOptions, SimParams } from './engine/params'

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

/** Which rendering/simulation backend to use. `'auto'` picks the best available. */
export type BackendKind = 'auto' | 'webgpu' | 'webgl2' | 'canvas2d'

export interface DotimationStats {
  backend: 'webgpu' | 'webgl2' | 'canvas2d'
  particles: number
}

// Compatibility exports: the React package historically exposed these types.
export type { Backend, FieldTargets, ParticleField } from './engine/types'
