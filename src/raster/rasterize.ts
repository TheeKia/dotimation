import type { AnimateItem, FieldTargets } from '@/types'
import { getCtx, getDpr } from '@/utils/utils'
import { drawImage, drawText } from './draw'
import { emptyFieldTargets, invertPixels, sampleTargets } from './sample'

export async function rasterize(
  width: number,
  height: number,
  item: AnimateItem,
  defaultFontFamily: string,
  alpha: number,
  pointSpacingCss: number,
  maxParticles: number = Number.POSITIVE_INFINITY,
): Promise<FieldTargets> {
  const empty = emptyFieldTargets()

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

  const dpr = getDpr()
  const devW = canvas.width
  const devH = canvas.height
  const img = ctx.getImageData(0, 0, devW, devH)
  if (item.type === 'image' && item.invert) invertPixels(img.data)
  return sampleTargets(
    img.data,
    devW,
    devH,
    dpr,
    pointSpacingCss,
    alpha,
    undefined,
    maxParticles,
  )
}
