import type { Backend, ParticleField } from '@/types'
import { accumulate, FIXED_DT } from './clock'
import type { SimParams } from './params'
import { computeSettleDuration } from './settle'

export interface EngineOptions {
  backend: Backend
  canvas: HTMLCanvasElement
  dpr: number
  params: SimParams
}

export interface Engine {
  /** Push a reconciled field; `full` is forwarded to Backend.uploadField. */
  setField(field: ParticleField, full?: boolean): void
  /**
   * Apply new sim params live (dot size, jitter, spring, fade) without
   * recreating anything. Also re-derives the loop policy: jitter > 0 means
   * the shimmer must stay visible, so the loop runs whenever on-screen;
   * jitter === 0 means nothing moves once settled, so the loop sleeps.
   */
  setParams(params: SimParams): void
  /**
   * Resize in place without tearing down the engine — the component calls this
   * on width/height changes so simulation state survives across resizes.
   */
  resize(devW: number, devH: number): void
  dispose(): void
}

export function createEngine(opts: EngineOptions): Engine {
  const { backend, canvas } = opts
  let params = opts.params
  let settleSeconds = computeSettleDuration(
    params.settleTime,
    params.opacityRate,
  )
  let continuous = params.jitter > 0
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
    for (let i = 0; i < r.steps; i++) backend.step(FIXED_DT)
    // Draw unconditionally while running: a skipped present is what made
    // cleared-buffer flicker possible on high-refresh displays, and skipping
    // was only ever worth it when preserveDrawingBuffer paid for it on every
    // real present.
    backend.draw()
    // With jitter active the field never converges (by design), so the
    // settled() early-sleep only applies on the jitter === 0 path.
    if (!continuous && (now >= awakeUntil || backend.settled?.())) {
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
    awakeUntil = performance.now() + settleSeconds * 1000
    if (!running && visible) start()
  }

  const io =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          visible = entries[0]?.isIntersecting ?? true
          if (visible) {
            // Continuous (jitter > 0) must run whenever on-screen; otherwise
            // only resume if still inside the wake window.
            if (continuous || performance.now() < awakeUntil) start()
          } else {
            stop()
          }
        })
      : null
  io?.observe(canvas)

  return {
    setField(field, full): void {
      backend.uploadField(field, full)
      wake()
    },
    setParams(next): void {
      params = next
      backend.setParams(next)
      settleSeconds = computeSettleDuration(next.settleTime, next.opacityRate)
      continuous = next.jitter > 0
      if (continuous) {
        if (visible && !running) start()
      } else {
        // One settle window so an in-flight morph (or a fresh dot size)
        // paints before the loop stops itself.
        wake()
      }
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
