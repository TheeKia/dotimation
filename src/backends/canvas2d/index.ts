import type { SimParams } from '@/engine/params'
import { isFieldSettled } from '@/engine/rest'
import type { Backend, ParticleField } from '@/types'
import {
  computeDirtyRect,
  type DirtyRect,
  renderField,
  unionRect,
} from './render'
import { stepField } from './simulate'

export function createCanvas2DBackend(initial: SimParams): Backend {
  let ctx: CanvasRenderingContext2D | null = null
  let imageData: ImageData | null = null
  let view: Uint32Array | null = null
  let devW = 0
  let devH = 0
  let dpr = 1
  let field: ParticleField | null = null
  let p = initial
  let prevDirty: DirtyRect | null = null
  // stepField's per-step convergence report; null = no step since the last
  // upload (fall back to the O(count) reference predicate once).
  let settledFlag: boolean | null = null

  function ensureBuffer(): void {
    if (!ctx) return
    if (!imageData || imageData.width !== devW || imageData.height !== devH) {
      imageData = ctx.createImageData(devW, devH)
      view = new Uint32Array(imageData.data.buffer)
    }
  }

  return {
    init(canvas, devicePixelRatio): void {
      dpr = devicePixelRatio
      devW = canvas.width
      devH = canvas.height
      // Throws instead of silently rendering nothing: getContext('2d') returns
      // null when the canvas is already bound to another context type (a GPU
      // tier acquired it, then failed mid-init).
      const context = canvas.getContext('2d')
      if (!context) throw new Error('canvas2d: 2d context unavailable')
      ctx = context
      ctx.imageSmoothingEnabled = false
      ensureBuffer()
    },
    uploadField(next): void {
      field = next
      settledFlag = null
    },
    setDotSize(next): void {
      p = { ...p, dotSize: next }
    },
    setParams(next): void {
      p = next
    },
    step(dt): void {
      if (field) settledFlag = stepField(field, dt, p)
    },
    draw(): void {
      if (!ctx || !field) return
      ensureBuffer()
      if (!imageData || !view) return
      const cur = computeDirtyRect(field, devW, devH, dpr, p.dotSize)
      const clearR = unionRect(prevDirty, cur)
      prevDirty = cur
      if (!clearR) return
      renderField(view, field, devW, devH, dpr, p.dotSize, clearR)
      ctx.putImageData(imageData, 0, 0, clearR.x, clearR.y, clearR.w, clearR.h)
    },
    settled(): boolean {
      if (!field) return true
      return settledFlag ?? isFieldSettled(field)
    },
    resize(w, h): void {
      devW = w
      devH = h
      imageData = null
      view = null
      prevDirty = null
      ensureBuffer()
    },
    dispose(): void {
      ctx = null
      imageData = null
      view = null
      field = null
    },
  }
}
