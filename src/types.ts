import type { SimParams } from '@/engine/params'

export type { DotOptions, MotionOptions, SimParams } from '@/engine/params'

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

/** Rasterizer output: the desired layout (home positions/colors only). */
export interface FieldTargets {
  count: number
  homeX: Float32Array
  homeY: Float32Array
  homeR: Float32Array
  homeG: Float32Array
  homeB: Float32Array
}

/**
 * Live simulation state in Structure-of-Arrays form.
 * Slots [0, active) are the current layout (targetAlpha = 1).
 * Slots [active, count) are faders leaving the layout (targetAlpha = 0).
 */
export interface ParticleField {
  active: number
  count: number
  capacity: number
  x: Float32Array
  y: Float32Array
  vx: Float32Array
  vy: Float32Array
  homeX: Float32Array
  homeY: Float32Array
  r: Float32Array
  g: Float32Array
  b: Float32Array
  homeR: Float32Array
  homeG: Float32Array
  homeB: Float32Array
  alpha: Float32Array
  targetAlpha: Float32Array
}

export interface DotimationStats {
  backend: 'webgpu' | 'webgl2' | 'canvas2d'
  particles: number
}

export interface Backend {
  init(canvas: HTMLCanvasElement, dpr: number): Promise<void> | void
  /**
   * Push the reconciled CPU field. `full` forces a complete state re-upload
   * (GPU tiers adopt field.active/count verbatim instead of diffing via
   * planReconcile) — used when the CPU field was mutated outside reconcile,
   * e.g. snapField under prefers-reduced-motion.
   */
  uploadField(field: ParticleField, full?: boolean): void
  /**
   * Apply new sim params live; read at step/draw time. Carries dot size,
   * jitter, spring k/c, settleTime, and the color/opacity ease rates.
   */
  setParams(params: SimParams): void
  step(dt: number): void
  draw(): void
  /** Optional: true when the field has visibly converged, so the engine may sleep early. */
  settled?(): boolean
  resize(devW: number, devH: number): void
  dispose(): void
}
