import type { AnimateItem, FieldTargets } from '@/types'
import { getCtx } from '@/utils/utils'
import { drawImage, drawText } from './draw'
import { sampleTargets } from './sample'

export async function rasterize(
  width: number,
  height: number,
  item: AnimateItem,
  defaultFontFamily: string,
  alpha: number,
  pointSpacingCss: number,
  maxParticles: number = Number.POSITIVE_INFINITY,
): Promise<FieldTargets> {
  const empty: FieldTargets = {
    count: 0,
    homeX: new Float32Array(0),
    homeY: new Float32Array(0),
    homeR: new Float32Array(0),
    homeG: new Float32Array(0),
    homeB: new Float32Array(0),
  }

  const canvas = document.createElement('canvas')
  const ctx = getCtx(canvas, width, height)
  if (!ctx) return empty

  if (item.type === 'image') {
    const image = new Image()
    // crossOrigin must be set BEFORE src or the request goes out without CORS,
    // tainting the canvas and making getImageData throw for cross-origin images.
    image.crossOrigin = 'anonymous'
    image.src = item.data
    await image.decode()
    drawImage(ctx, image, image.width, image.height, width, height, item)
  } else {
    drawText(ctx, item, width, height, defaultFontFamily)
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const devW = canvas.width
  const devH = canvas.height
  const img = ctx.getImageData(0, 0, devW, devH)
  return sampleTargets(
    img.data,
    devW,
    devH,
    dpr,
    pointSpacingCss,
    alpha,
    Math.random,
    maxParticles,
  )
}
