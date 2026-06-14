import type { AnimateItem, FieldTargets } from '@/types'
import { getAutoFontSize, getMonospaceFontSize } from '@/utils/font'
import { getCtx } from '@/utils/utils'
import { sampleTargets } from './sample'

const DEFAULT_TEXT_COLOR = 'rgb(200,200,200)'

function getScale(
  width: number,
  height: number,
  image: HTMLImageElement,
  item: Extract<AnimateItem, { type: 'image' }>,
): number {
  const wScale = item.maxWidth
    ? item.maxWidth / image.width
    : Number.POSITIVE_INFINITY
  const hScale = item.maxHeight
    ? item.maxHeight / image.height
    : Number.POSITIVE_INFINITY
  const userScale = Math.min(wScale, hScale)
  const scaleLimit = Math.min(width / image.width, height / image.height)
  return Math.min(userScale, scaleLimit)
}

export async function rasterize(
  width: number,
  height: number,
  item: AnimateItem,
  defaultFontFamily: string,
  alpha: number,
  pointSpacingCss: number,
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
    image.src = item.data
    image.crossOrigin = 'anonymous'
    await image.decode()
    const scale = getScale(width, height, image, item)
    const sw = image.width * scale
    const sh = image.height * scale
    const x = (width - sw) / 2
    const y = (height - sh) / 2
    if (item.invert) {
      ctx.save()
      ctx.filter = 'invert(1)'
      ctx.drawImage(image, x, y, sw, sh)
      ctx.restore()
    } else {
      ctx.drawImage(image, x, y, sw, sh)
    }
  } else {
    let fontSize: number
    if (item.fontSize === 'AUTO_MONO') {
      fontSize = getMonospaceFontSize(width, item.data)
    } else if (item.fontSize === 'AUTO' || item.fontSize === undefined) {
      fontSize = getAutoFontSize(width, item.data)
    } else {
      fontSize = item.fontSize
    }
    ctx.font = `${fontSize}px ${item.fontFamily || defaultFontFamily}`
    ctx.fillStyle = item.textColor || DEFAULT_TEXT_COLOR
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const lines = item.data.split('\n')
    const lineHeight = fontSize * 1.2
    const startY = (height - lines.length * lineHeight) / 2 + lineHeight / 2
    for (const [index, line] of lines.entries()) {
      ctx.fillText(line, width / 2, startY + index * lineHeight)
    }
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const devW = canvas.width
  const devH = canvas.height
  const img = ctx.getImageData(0, 0, devW, devH)
  return sampleTargets(img.data, devW, devH, dpr, pointSpacingCss, alpha)
}
