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
  type GPUBuffers,
  packState,
  packTargets,
} from './buffers'
import { acquireGPU } from './device'
import { createPipelines, type Pipelines } from './pipelines'

export interface WebGPUOptions {
  dotSize: number
}

const STATE_STRIDE_BYTES = STATE_FLOATS * 4

export function createWebGPUBackend(opts: WebGPUOptions): Backend {
  let device: GPUDevice | null = null
  let context: GPUCanvasContext | null = null
  let pipelines: Pipelines | null = null
  let buffers: GPUBuffers | null = null
  let devW = 0
  let devH = 0
  let dpr = 1
  let count = 0
  let active = 0
  let lost = false
  let lastUpload = 0
  let dotSize = opts.dotSize
  const { k, c } = tuneSpring({ settleTime: SETTLE_TIME, zeta: ZETA })
  const FADE_DURATION_MS = (1 / OPACITY_RATE + 0.15) * 1000

  // Bind groups and uniform staging are stable across frames, so they are
  // created once (and rebuilt only when the buffers are recreated) instead of
  // per step/draw. simBindGroups is indexed by the ping-pong read index.
  let simBindGroups: [GPUBindGroup, GPUBindGroup] | null = null
  let renderBind: GPUBindGroup | null = null
  const simU = new Float32Array(8)
  const renderU = new Float32Array(4)
  // The render uniforms (devW/devH/dpr/dotSize) change only on resize/dotSize,
  // so the GPU write is skipped on frames where they are unchanged.
  let renderUniformDirty = true

  function rebuildBindGroups(): void {
    if (!device || !pipelines || !buffers) return
    const b = buffers
    simBindGroups = [
      pipelines.simBindGroup(b.state[0], b.state[1], b.targets),
      pipelines.simBindGroup(b.state[1], b.state[0], b.targets),
    ]
    renderBind = pipelines.renderBindGroup()
  }

  function ensureCapacity(cap: number): void {
    if (!device || !buffers || buffers.capacity >= cap) return
    const old = buffers
    const next = createBuffers(device, cap)
    if (count > 0) {
      const enc = device.createCommandEncoder()
      enc.copyBufferToBuffer(
        old.state[old.read],
        0,
        next.state[0],
        0,
        count * STATE_STRIDE_BYTES,
      )
      device.queue.submit([enc.finish()])
    }
    next.read = 0
    disposeBuffers(old)
    buffers = next
    // The cached bind groups referenced the disposed buffers; rebuild them.
    rebuildBindGroups()
  }

  return {
    async init(canvas, devicePixelRatio): Promise<void> {
      dpr = devicePixelRatio
      devW = canvas.width
      devH = canvas.height
      const setup = await acquireGPU(canvas)
      device = setup.device
      context = setup.context
      pipelines = createPipelines(device, setup.format)
      buffers = createBuffers(device, 1024)
      rebuildBindGroups()
      void device.lost.then(() => {
        lost = true
      })
    },
    uploadField(field: ParticleField): void {
      if (!device || !buffers) return
      const plan = planReconcile(active, count, field.active)
      ensureCapacity(field.capacity)
      const b = buffers
      const current = b.state[b.read]!
      const other = b.state[b.read ^ 1]!

      device.queue.writeBuffer(b.targets, 0, packTargets(field, field.count))

      if (plan.firstLoad) {
        device.queue.writeBuffer(current, 0, packState(field, 0, field.count))
      } else if (plan.relocate) {
        const enc = device.createCommandEncoder()
        enc.copyBufferToBuffer(
          current,
          0,
          other,
          0,
          plan.overlap * STATE_STRIDE_BYTES,
        )
        enc.copyBufferToBuffer(
          current,
          plan.relocate.from * STATE_STRIDE_BYTES,
          other,
          plan.relocate.to * STATE_STRIDE_BYTES,
          plan.relocate.len * STATE_STRIDE_BYTES,
        )
        device.queue.submit([enc.finish()])
        if (plan.spawn) {
          device.queue.writeBuffer(
            other,
            plan.spawn.start * STATE_STRIDE_BYTES,
            packState(field, plan.spawn.start, plan.spawn.end),
          )
        }
        b.read = (b.read ^ 1) as 0 | 1
      } else if (plan.spawn) {
        device.queue.writeBuffer(
          current,
          plan.spawn.start * STATE_STRIDE_BYTES,
          packState(field, plan.spawn.start, plan.spawn.end),
        )
      }

      active = plan.active
      count = plan.count
      lastUpload = performance.now()
    },
    setDotSize(next: number): void {
      dotSize = next
      renderUniformDirty = true
    },
    step(dt: number): void {
      if (!device || !buffers || !pipelines || !simBindGroups || lost) return
      if (count <= 0) return
      if (count > active && performance.now() - lastUpload > FADE_DURATION_MS) {
        count = active
      }
      const b = buffers
      simU[0] = dt
      simU[1] = k
      simU[2] = c
      simU[3] = COLOR_RATE
      simU[4] = OPACITY_RATE
      simU[5] = JITTER_AMOUNT
      simU[6] = Math.random() * 1000
      simU[7] = count
      device.queue.writeBuffer(pipelines.simUniform, 0, simU)
      const enc = device.createCommandEncoder()
      const pass = enc.beginComputePass()
      pass.setPipeline(pipelines.compute)
      pass.setBindGroup(0, simBindGroups[b.read])
      pass.dispatchWorkgroups(Math.ceil(count / 64))
      pass.end()
      device.queue.submit([enc.finish()])
      b.read = (b.read ^ 1) as 0 | 1
    },
    draw(): void {
      if (!device || !context || !buffers || !pipelines || !renderBind || lost)
        return
      const b = buffers
      if (renderUniformDirty) {
        renderU[0] = devW
        renderU[1] = devH
        renderU[2] = dpr
        renderU[3] = dotSize
        device.queue.writeBuffer(pipelines.renderUniform, 0, renderU)
        renderUniformDirty = false
      }
      const enc = device.createCommandEncoder()
      const view = context.getCurrentTexture().createView()
      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })
      if (count > 0) {
        pass.setPipeline(pipelines.render)
        pass.setBindGroup(0, renderBind)
        pass.setVertexBuffer(0, b.quad)
        pass.setVertexBuffer(1, b.state[b.read]!)
        pass.draw(4, count)
      }
      pass.end()
      device.queue.submit([enc.finish()])
    },
    resize(w: number, h: number): void {
      devW = w
      devH = h
      renderUniformDirty = true
    },
    dispose(): void {
      if (buffers) disposeBuffers(buffers)
      pipelines?.simUniform.destroy()
      pipelines?.renderUniform.destroy()
      device = null
      context = null
      pipelines = null
      buffers = null
      simBindGroups = null
      renderBind = null
    },
  }
}
