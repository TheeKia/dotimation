import type { Backend, IdleBehavior, ParticleField } from '@/types'
import { accumulate } from './clock'
import { computeSettleDuration } from './settle'

export interface EngineOptions {
  backend: Backend
  canvas: HTMLCanvasElement
  dpr: number
  idle: IdleBehavior
}

const SETTLE_SECONDS = computeSettleDuration(0.85, 2)

export interface Engine {
  setField(field: ParticleField): void
  resize(devW: number, devH: number): void
  dispose(): void
}

export function createEngine(opts: EngineOptions): Engine {
  const { backend, canvas, idle } = opts
  let rafId = 0
  let running = false
  let last = 0
  let accumulator = 0
  let awakeUntil = 0
  let visible = true

  const loop = (now: number): void => {
    const r = accumulate(accumulator, (now - last) / 1000)
    last = now
    accumulator = r.accumulator
    for (let i = 0; i < r.steps; i++) backend.step(1 / 90)
    backend.draw()
    if (idle === 'sleep' && now >= awakeUntil) {
      stop()
      return
    }
    rafId = requestAnimationFrame(loop)
  }

  const start = (): void => {
    if (running) return
    running = true
    last = performance.now()
    accumulator = 0
    rafId = requestAnimationFrame(loop)
  }

  const stop = (): void => {
    running = false
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
  }

  const wake = (): void => {
    awakeUntil = performance.now() + SETTLE_SECONDS * 1000
    if (!running && visible) start()
  }

  const io =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          visible = entries[0]?.isIntersecting ?? true
          if (visible) {
            if (performance.now() < awakeUntil) start()
          } else {
            stop()
          }
        })
      : null
  io?.observe(canvas)

  return {
    setField(field): void {
      backend.uploadField(field)
      wake()
    },
    resize(devW, devH): void {
      backend.resize(devW, devH)
      wake()
    },
    dispose(): void {
      stop()
      io?.disconnect()
      backend.dispose()
    },
  }
}
