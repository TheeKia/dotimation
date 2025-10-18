import type { RefObject } from 'react'

import type { Particle } from '../types'

function tuneSpring({
  settleTime = 0.5,
  zeta = 1,
}: {
  settleTime?: number
  zeta?: number
}) {
  const wn = 4 / (zeta * settleTime) // rad/s
  const k = wn * wn // stiffness
  const c = 2 * zeta * wn // damping
  return { k, c }
}

function expLerp(current: number, target: number, rate: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-rate * dt))
}

const colorRate = 2
const opacityRate = 2
const physicsHz = 90
const fixedDt = 1 / physicsHz // seconds per physics step
const maxStepsPerFrame = 8 // prevents spiral after tab restore
const { k, c } = tuneSpring({ settleTime: 0.85, zeta: 1 })
const jitterHz = 15
const jitterPeriod = 1 / jitterHz
const jitterAmount = 1

function advance(p: Particle, fadeUp: boolean, dt: number, doJitter: boolean) {
  const dx = p.homeX - p.x
  const dy = p.homeY - p.y
  const ax = k * dx - c * p.vx
  const ay = k * dy - c * p.vy

  p.vx += ax * dt
  p.vy += ay * dt
  p.x += p.vx * dt
  p.y += p.vy * dt

  if (doJitter) p.x += (Math.random() - 0.5) * jitterAmount

  p.r = expLerp(p.r, p.homeR, colorRate, dt)
  p.g = expLerp(p.g, p.homeG, colorRate, dt)
  p.b = expLerp(p.b, p.homeB, colorRate, dt)

  p.opacity = Math[fadeUp ? 'min' : 'max'](
    fadeUp ? 1 : 0,
    p.opacity + (fadeUp ? 1 : -1) * opacityRate * dt,
  )
}

export function animateParticles(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  particlesRef: RefObject<Particle[]>,
  intermediateRef: RefObject<Particle[]>,
  signal: AbortSignal,
): void {
  let frameId = 0

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const devW = canvas.width
  const devH = canvas.height

  let last = performance.now()
  let accumulator = 0
  let jitterClock = 0

  let imageData: ImageData | null = null

  const onAbort = () => {
    if (frameId) cancelAnimationFrame(frameId)
    signal.removeEventListener('abort', onAbort)
  }
  if (signal.aborted) return
  signal.addEventListener('abort', onAbort, { once: true })

  function stepPhysics(dt: number) {
    const arr = particlesRef.current
    const inter = intermediateRef.current
    if (!arr.length && !inter.length) return

    jitterClock += dt
    const doJitter = jitterClock >= jitterPeriod
    if (doJitter) jitterClock -= jitterPeriod

    for (let i = 0; i < inter.length; i++)
      advance(inter[i]!, false, dt, doJitter)
    let w = 0
    for (let r = 0; r < inter.length; r++)
      if (inter[r]!.opacity > 0.001) inter[w++] = inter[r]!
    inter.length = w
    intermediateRef.current = inter
    for (let i = 0; i < arr.length; i++) advance(arr[i]!, true, dt, doJitter)
  }

  function render() {
    const arr = particlesRef.current
    const inter = intermediateRef.current

    // Prepare buffer (device size)
    if (!imageData || imageData.width !== devW || imageData.height !== devH) {
      imageData = ctx.createImageData(devW, devH)
    } else {
      imageData.data.fill(0)
    }
    const data = imageData.data

    const drawPointCss = (p: Particle) => {
      const sa = Math.max(0, Math.min(1, p.opacity))
      if (sa <= 0) return

      const xDev = Math.round(p.x * dpr)
      const yDev = Math.round(p.y * dpr)
      if (xDev < 0 || yDev < 0 || xDev >= devW || yDev >= devH) return

      const base = (yDev * devW + xDev) * 4

      const sr = Math.min(255, Math.max(0, p.r)) / 255
      const sg = Math.min(255, Math.max(0, p.g)) / 255
      const sb = Math.min(255, Math.max(0, p.b)) / 255

      const dr = data[base]! / 255
      const dg = data[base + 1]! / 255
      const db = data[base + 2]! / 255
      const da = data[base + 3]! / 255

      const outA = sa + da * (1 - sa)
      let outR = 0,
        outG = 0,
        outB = 0
      if (outA > 0) {
        outR = (sr * sa + dr * da * (1 - sa)) / outA
        outG = (sg * sa + dg * da * (1 - sa)) / outA
        outB = (sb * sa + db * da * (1 - sa)) / outA
      }

      data[base] = Math.round(outR * 255)
      data[base + 1] = Math.round(outG * 255)
      data[base + 2] = Math.round(outB * 255)
      data[base + 3] = Math.round(outA * 255)
    }

    for (let i = 0; i < arr.length; i++) drawPointCss(arr[i]!)
    for (let i = 0; i < inter.length; i++) drawPointCss(inter[i]!)

    ctx.putImageData(imageData, 0, 0)
  }

  const loop = (now: number) => {
    const frameDelta = Math.min(0.05, (now - last) / 1000)
    last = now
    accumulator += frameDelta

    let steps = 0
    while (accumulator >= fixedDt && steps < maxStepsPerFrame) {
      stepPhysics(fixedDt)
      accumulator -= fixedDt
      steps++
    }

    render()
    frameId = requestAnimationFrame(loop)
  }

  frameId = requestAnimationFrame(loop)
}
