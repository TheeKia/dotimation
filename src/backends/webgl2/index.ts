import {
  COLOR_RATE,
  JITTER_AMOUNT,
  OPACITY_RATE,
  SETTLE_TIME,
  ZETA,
} from '@/engine/constants'
import { planReconcile, STATE_FLOATS } from '@/engine/reconcile-plan'
import { tuneSpring } from '@/engine/settle'
import type { Backend, ParticleField } from '@/types'
import {
  createBuffers,
  disposeBuffers,
  type GLBuffers,
  packState,
  packTargets,
} from './buffers'
import { getGL } from './gl'
import { createDrawProgram, type DrawProgram } from './program-draw'
import { createSimProgram, type SimProgram } from './program-sim'

export interface WebGL2Options {
  dotSize: number
}

const STATE_STRIDE_BYTES = STATE_FLOATS * 4

export function createWebGL2Backend(opts: WebGL2Options): Backend {
  let gl: WebGL2RenderingContext | null = null
  let canvasEl: HTMLCanvasElement | null = null
  let buffers: GLBuffers | null = null
  let sim: SimProgram | null = null
  let draw: DrawProgram | null = null
  let devW = 0
  let devH = 0
  let dpr = 1
  let count = 0
  let active = 0
  let lost = false
  let lastUpload = 0
  const { k, c } = tuneSpring({ settleTime: SETTLE_TIME, zeta: ZETA })
  // Faders fade out at OPACITY_RATE; after this long they are invisible and the
  // tail can be dropped. The Canvas2D backend compacts faders in stepField; the
  // GPU sim doesn't change count, so we expire them here by elapsed time.
  const FADE_DURATION_MS = (1 / OPACITY_RATE + 0.15) * 1000

  const onLost = (e: Event): void => {
    e.preventDefault()
    lost = true
  }
  const onRestored = (): void => {
    // Best-effort: rebuild GL resources; field will be re-uploaded on next reconcile.
    if (canvasEl) init(canvasEl, dpr)
    lost = false
  }

  function ensureCapacity(cap: number): void {
    if (!gl || !buffers || buffers.capacity >= cap) return
    const old = buffers
    const next = createBuffers(gl, cap)
    // Preserve the live state buffer (only [0,count) is meaningful) so growing
    // past capacity doesn't wipe in-flight particles. Targets are re-uploaded by
    // uploadField right after, so they don't need preserving here.
    if (count > 0) {
      gl.bindBuffer(gl.COPY_READ_BUFFER, old.state[old.read])
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, next.state[0])
      gl.copyBufferSubData(
        gl.COPY_READ_BUFFER,
        gl.COPY_WRITE_BUFFER,
        0,
        0,
        count * STATE_STRIDE_BYTES,
      )
    }
    next.read = 0
    disposeBuffers(gl, old)
    buffers = next
  }

  function init(canvas: HTMLCanvasElement, devicePixelRatio: number): void {
    canvasEl = canvas
    dpr = devicePixelRatio
    devW = canvas.width
    devH = canvas.height
    const context = getGL(canvas)
    if (!context) throw new Error('webgl2: context unavailable')
    gl = context
    canvas.addEventListener('webglcontextlost', onLost, false)
    canvas.addEventListener('webglcontextrestored', onRestored, false)
    buffers = createBuffers(gl, 1024)
    sim = createSimProgram(gl)
    draw = createDrawProgram(gl)
    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.viewport(0, 0, devW, devH)
  }

  return {
    init,
    uploadField(field: ParticleField): void {
      if (!gl || !buffers) return
      const plan = planReconcile(active, count, field.active) // field.active == new targets.count
      ensureCapacity(field.capacity)
      const b = buffers
      const current = b.state[b.read]!
      const other = b.state[b.read ^ 1]!

      // targets buffer: always full re-upload from the reconciled field.
      gl.bindBuffer(gl.ARRAY_BUFFER, b.targets)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, packTargets(field, field.count))

      if (plan.firstLoad) {
        gl.bindBuffer(gl.ARRAY_BUFFER, current)
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, packState(field, 0, field.count))
      } else if (plan.relocate) {
        // Overlap clobber-safe rebuild into the OTHER buffer, then swap.
        gl.bindBuffer(gl.COPY_READ_BUFFER, current)
        gl.bindBuffer(gl.COPY_WRITE_BUFFER, other)
        // keep overlap [0, overlap)
        gl.copyBufferSubData(
          gl.COPY_READ_BUFFER,
          gl.COPY_WRITE_BUFFER,
          0,
          0,
          plan.overlap * STATE_STRIDE_BYTES,
        )
        // relocate faders [from,from+len) -> [to,to+len)
        gl.copyBufferSubData(
          gl.COPY_READ_BUFFER,
          gl.COPY_WRITE_BUFFER,
          plan.relocate.from * STATE_STRIDE_BYTES,
          plan.relocate.to * STATE_STRIDE_BYTES,
          plan.relocate.len * STATE_STRIDE_BYTES,
        )
        // spawn new actives into the gap [start,end)
        if (plan.spawn) {
          gl.bindBuffer(gl.ARRAY_BUFFER, other)
          gl.bufferSubData(
            gl.ARRAY_BUFFER,
            plan.spawn.start * STATE_STRIDE_BYTES,
            packState(field, plan.spawn.start, plan.spawn.end),
          )
        }
        b.read = (b.read ^ 1) as 0 | 1
      } else if (plan.spawn) {
        // growth without faders: spawn region is beyond old count -> safe in place.
        gl.bindBuffer(gl.ARRAY_BUFFER, current)
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          plan.spawn.start * STATE_STRIDE_BYTES,
          packState(field, plan.spawn.start, plan.spawn.end),
        )
      }
      // shrink: nothing to do for state (targets already re-uploaded).

      active = plan.active
      count = plan.count
      lastUpload = performance.now()
    },
    step(dt: number): void {
      if (!gl || !buffers || !sim || lost || count <= 0) return
      // Drop fully-faded faders (the GPU sim never shrinks count itself).
      if (count > active && performance.now() - lastUpload > FADE_DURATION_MS) {
        count = active
      }
      const b = buffers
      // Jitter every step, matching the Canvas2D backend's shimmer frequency.
      sim.step(b.state[b.read]!, b.state[b.read ^ 1]!, b.targets, count, {
        dt,
        k,
        c,
        colorRate: COLOR_RATE,
        opacityRate: OPACITY_RATE,
        jitter: JITTER_AMOUNT,
        seed: Math.random() * 1000,
      })
      b.read = (b.read ^ 1) as 0 | 1
    },
    draw(): void {
      if (!gl || !buffers || !draw || lost) return
      gl.viewport(0, 0, devW, devH)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      const b = buffers
      draw.use(b.state[b.read], b.quad, count, {
        devW,
        devH,
        dpr,
        dotSize: opts.dotSize,
      })
    },
    resize(w: number, h: number): void {
      devW = w
      devH = h
      if (gl) gl.viewport(0, 0, w, h)
    },
    dispose(): void {
      if (canvasEl) {
        canvasEl.removeEventListener('webglcontextlost', onLost)
        canvasEl.removeEventListener('webglcontextrestored', onRestored)
      }
      if (gl && buffers) disposeBuffers(gl, buffers)
      sim?.dispose()
      draw?.dispose()
      gl = null
      buffers = null
      sim = null
      draw = null
    },
  }
}
