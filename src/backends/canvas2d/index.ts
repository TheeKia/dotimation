import { tuneSpring } from '@/engine/settle'
import type { Backend, ParticleField } from '@/types'
import { renderField } from './render'
import { stepField } from './simulate'

export interface Canvas2DOptions {
  dotSize: number
}

export function createCanvas2DBackend(opts: Canvas2DOptions): Backend {
  let ctx: CanvasRenderingContext2D | null = null
  let imageData: ImageData | null = null
  let view: Uint32Array | null = null
  let devW = 0
  let devH = 0
  let dpr = 1
  let field: ParticleField | null = null
  const { k, c } = tuneSpring({ settleTime: 0.85, zeta: 1 })

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
      ctx = canvas.getContext('2d')
      if (ctx) ctx.imageSmoothingEnabled = false
      ensureBuffer()
    },
    uploadField(next): void {
      field = next
    },
    step(dt): void {
      if (field) stepField(field, dt, k, c)
    },
    draw(): void {
      if (!ctx || !field) return
      ensureBuffer()
      if (!imageData || !view) return
      renderField(view, field, devW, devH, dpr, opts.dotSize)
      ctx.putImageData(imageData, 0, 0)
    },
    resize(w, h): void {
      devW = w
      devH = h
      imageData = null
      view = null
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
