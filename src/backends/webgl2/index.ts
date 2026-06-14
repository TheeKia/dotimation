import {
  COLOR_RATE,
  JITTER_AMOUNT,
  OPACITY_RATE,
  SETTLE_TIME,
  ZETA,
} from '@/engine/constants'
import {
  planReconcile,
  STATE_FLOATS,
  TARGET_FLOATS,
} from '@/engine/reconcile-plan'
import { tuneSpring } from '@/engine/settle'
import type { Backend, ParticleField } from '@/types'
import {
  createBuffers,
  disposeBuffers,
  type GLBuffers,
  packStateInto,
  packTargetsInto,
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
  let dotSize = opts.dotSize
  let lastField: ParticleField | null = null
  let stateScratch = new Float32Array(1024 * STATE_FLOATS)
  let targetScratch = new Float32Array(1024 * TARGET_FLOATS)
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
    // The same context object is reused after a restore, but every GL resource
    // was lost. Rebuild them, reset the live counts so the next upload is a
    // fresh load, and re-seed from the last field so the canvas isn't blank
    // until the next reconcile happens to fire.
    if (!gl) return
    active = 0
    count = 0
    buildResources()
    lost = false
    if (lastField) api.uploadField(lastField)
  }

  function buildResources(): void {
    if (!gl) return
    buffers = createBuffers(gl, 1024)
    sim = createSimProgram(gl)
    draw = createDrawProgram(gl)
    sim.setBuffers(buffers.state[0], buffers.state[1], buffers.targets)
    draw.setBuffers(buffers.state[0], buffers.state[1], buffers.quad)
    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
    )
    // Clear color never changes; set once here instead of per frame.
    gl.clearColor(0, 0, 0, 0)
    gl.viewport(0, 0, devW, devH)
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
    // The old VAOs referenced the disposed buffers; rebind them to the new ones.
    sim?.setBuffers(next.state[0], next.state[1], next.targets)
    draw?.setBuffers(next.state[0], next.state[1], next.quad)
    if (stateScratch.length < next.capacity * STATE_FLOATS) {
      stateScratch = new Float32Array(next.capacity * STATE_FLOATS)
    }
    if (targetScratch.length < next.capacity * TARGET_FLOATS) {
      targetScratch = new Float32Array(next.capacity * TARGET_FLOATS)
    }
  }

  function init(canvas: HTMLCanvasElement, devicePixelRatio: number): void {
    canvasEl = canvas
    dpr = devicePixelRatio
    devW = canvas.width
    devH = canvas.height
    const context = getGL(canvas)
    if (!context) throw new Error('webgl2: context unavailable')
    gl = context
    // Listeners are added once here (not in buildResources) so a context
    // restore doesn't stack duplicate handlers.
    canvas.addEventListener('webglcontextlost', onLost, false)
    canvas.addEventListener('webglcontextrestored', onRestored, false)
    buildResources()
  }

  const api: Backend = {
    init,
    uploadField(field: ParticleField): void {
      if (!gl || !buffers) return
      lastField = field
      const plan = planReconcile(active, count, field.active) // field.active == new targets.count
      ensureCapacity(field.capacity)
      const b = buffers
      const current = b.state[b.read]!
      const other = b.state[b.read ^ 1]!

      // targets buffer: always full re-upload from the reconciled field.
      gl.bindBuffer(gl.ARRAY_BUFFER, b.targets)
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        packTargetsInto(targetScratch, field, field.count),
      )

      if (plan.firstLoad) {
        gl.bindBuffer(gl.ARRAY_BUFFER, current)
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          0,
          packStateInto(stateScratch, field, 0, field.count),
        )
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
            packStateInto(
              stateScratch,
              field,
              plan.spawn.start,
              plan.spawn.end,
            ),
          )
        }
        b.read = (b.read ^ 1) as 0 | 1
      } else if (plan.spawn) {
        // Growth: write the new actives in place over slots [prevActive,end).
        // The live overlap [0,prevActive) is untouched; any superseded fader
        // slots in that span are simply overwritten (they are being dropped),
        // and count stops at the spawn end, so nothing past it is drawn.
        gl.bindBuffer(gl.ARRAY_BUFFER, current)
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          plan.spawn.start * STATE_STRIDE_BYTES,
          packStateInto(stateScratch, field, plan.spawn.start, plan.spawn.end),
        )
      }
      // Otherwise (a shrink) nothing to do for state: the live overlap stays put
      // and the re-uploaded targets flip the surplus to targetAlpha 0 so the sim
      // fades it out. Older faders are dropped by count, not touched here.

      active = plan.active
      count = plan.count
      lastUpload = performance.now()
    },
    setDotSize(next: number): void {
      dotSize = next
    },
    step(dt: number): void {
      if (!gl || !buffers || !sim || lost || count <= 0) return
      // Drop fully-faded faders (the GPU sim never shrinks count itself).
      if (count > active && performance.now() - lastUpload > FADE_DURATION_MS) {
        count = active
      }
      const b = buffers
      // Jitter every step, matching the Canvas2D backend's shimmer frequency.
      sim.step(b.read, count, {
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
      // viewport + clearColor are set on init/resize and never change here, so
      // only the per-frame clear remains.
      gl.clear(gl.COLOR_BUFFER_BIT)
      const b = buffers
      draw.use(b.read, count, {
        devW,
        devH,
        dpr,
        dotSize,
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
  return api
}
