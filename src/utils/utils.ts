import type { AnimateItem, Particle } from '../types'
import { getAutoFontSize, getMonospaceFontSize } from './font'

function getScale(
  width: number,
  height: number,
  image: HTMLImageElement,
  item: AnimateItem,
): number {
  if (item.type !== 'image') return 1

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

const DEFAULT_TEXT_COLOR = 'rgb(200,200,200)'

export async function initParticles(
  width: number,
  height: number,
  item: AnimateItem,
  defaultFontFamily: string,
  alpha: number,
  pointSpacingCss: number,
): Promise<Particle[]> {
  const canvas = document.createElement('canvas')
  const ctx = getCtx(canvas, width, height)
  if (!ctx) return []

  const dpr = Math.min(window.devicePixelRatio || 1, 2)

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
    const fontFamily = item.fontFamily || defaultFontFamily
    ctx.font = `${fontSize}px ${fontFamily}`
    ctx.fillStyle = item.textColor || DEFAULT_TEXT_COLOR
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const lines = item.data.split('\n')
    const lineHeight = fontSize * 1.2 // Standard line height multiplier
    const totalTextHeight = lines.length * lineHeight

    // Calculate starting Y position to center the entire text block
    const startY = (height - totalTextHeight) / 2 + lineHeight / 2

    // Render each line
    lines.forEach((line, index) => {
      const y = startY + index * lineHeight
      ctx.fillText(line, width / 2, y)
    })
    // ctx.fillText(item.data, width / 2, height / 2)
  }

  const devW = canvas.width // width * dpr
  const devH = canvas.height // height * dpr
  const img = ctx.getImageData(0, 0, devW, devH)
  const pixels = img.data

  const particles: Particle[] = []
  const stepDev = Math.max(1, Math.round(pointSpacingCss * dpr))

  for (let yDev = 0; yDev < devH; yDev += stepDev) {
    for (let xDev = 0; xDev < devW; xDev += stepDev) {
      const idx = (yDev * devW + xDev) * 4
      if (pixels[idx + 3]! > alpha) {
        const xCss = xDev / dpr
        const yCss = yDev / dpr
        const r = pixels[idx]!,
          g = pixels[idx + 1]!,
          b = pixels[idx + 2]!

        particles.push({
          x: xCss,
          y: yCss,
          homeX: xCss,
          homeY: yCss,
          vx: 0,
          vy: 0,
          opacity: -Math.random() * 3,
          homeR: r,
          homeG: g,
          homeB: b,
          r,
          g,
          b,
        })
      }
    }
  }

  // Fisher–Yates
  for (let i = particles.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0
    ;[particles[i], particles[j]] = [particles[j]!, particles[i]!]
  }

  return particles
}

export function getCtx(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0) // baseline: 1 CSS px == dpr device px
  ctx.imageSmoothingEnabled = false
  return ctx
}
