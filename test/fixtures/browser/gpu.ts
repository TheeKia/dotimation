import { createWebGL2Backend } from '../../../packages/core/src/backends/webgl2'
import {
  createField,
  reconcile,
  snapField,
} from '../../../packages/core/src/engine/field'
import {
  DEFAULT_MOTION,
  toSimParams,
} from '../../../packages/core/src/engine/params'

import type { Lifecycle } from './lifecycle'

export const gpuChecks: Pick<Lifecycle, 'verifyGpu' | 'verifyRestore'> = {
  async verifyGpu(kind) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    document.body.append(canvas)
    if (kind === 'webgl2')
      canvas.getContext('webgl2', { preserveDrawingBuffer: true })
    const params = {
      ...toSimParams({ ...DEFAULT_MOTION, jitter: 0 }, 1, false),
      k: 0,
      c: 0,
    }
    const backend =
      kind === 'webgl2'
        ? createWebGL2Backend(params)
        : (
            await import('../../../packages/core/src/backends/webgpu')
          ).createWebGPUBackend(params)
    const targets = (count: number) => ({
      count,
      homeX: Float32Array.from({ length: count }, (_, i) => i % 64),
      homeY: Float32Array.from({ length: count }, (_, i) => Math.floor(i / 64)),
      homeR: new Float32Array(count).fill(255),
      homeG: new Float32Array(count).fill(255),
      homeB: new Float32Array(count).fill(255),
    })
    const pixels = async (): Promise<number> => {
      backend.draw()
      if (kind === 'webgpu') {
        const context = canvas.getContext('webgpu')!
        const device = context.getConfiguration()!.device
        const readback = device.createBuffer({
          size: 64 * 64 * 4,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        })
        try {
          const encoder = device.createCommandEncoder()
          encoder.copyTextureToBuffer(
            { texture: context.getCurrentTexture() },
            { buffer: readback, bytesPerRow: 256 },
            [64, 64],
          )
          device.queue.submit([encoder.finish()])
          await readback.mapAsync(GPUMapMode.READ)
          return new Uint8Array(readback.getMappedRange()).filter(
            (v, i) => i % 4 === 3 && v > 0,
          ).length
        } finally {
          readback.destroy()
        }
      }
      const probe = document.createElement('canvas')
      probe.width = probe.height = 64
      const ctx = probe.getContext('2d')!
      ctx.drawImage(canvas, 0, 0)
      return ctx
        .getImageData(0, 0, 64, 64)
        .data.filter((v, i) => i % 4 === 3 && v > 0).length
    }
    const step = (count: number): void => {
      for (let i = 0; i < count; i++) {
        backend.step(1 / 90)
        backend.draw()
      }
    }
    try {
      await backend.init(canvas, 1)
      if (kind === 'webgpu') {
        const context = canvas.getContext('webgpu')!
        const config = context.getConfiguration()!
        context.configure({
          ...config,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        })
      }
      let field = reconcile(createField(1), targets(1))
      snapField(field)
      backend.uploadField(field, true)
      const initial = await pixels()
      field = reconcile(createField(1), targets(2048))
      backend.uploadField(field)
      step(90)
      const grown = await pixels()
      field = reconcile(field, targets(1))
      backend.uploadField(field)
      backend.setParams({ ...params, opacityRate: 0.1 })
      step(18)
      backend.setParams({ ...params, opacityRate: 10 })
      step(5)
      const duringFade = await pixels()
      step(90)
      return { initial, grown, duringFade, afterFade: await pixels() }
    } finally {
      canvas.remove()
      backend.dispose()
    }
  },
  async verifyRestore() {
    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 16
    document.body.append(canvas)
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })!
    const lose = gl.getExtension('WEBGL_lose_context')!
    const backend = createWebGL2Backend(
      toSimParams({ ...DEFAULT_MOTION, jitter: 0 }, 1, false),
    )
    await backend.init(canvas, 1)
    const field = reconcile(createField(1), {
      count: 1,
      homeX: Float32Array.of(8),
      homeY: Float32Array.of(8),
      homeR: Float32Array.of(255),
      homeG: Float32Array.of(0),
      homeB: Float32Array.of(0),
    })
    backend.uploadField(field)
    // GPU CPU snapshots start transparent and are never simulated on the CPU.
    try {
      const lost = new Promise<void>((resolve) =>
        canvas.addEventListener('webglcontextlost', () => resolve(), {
          once: true,
        }),
      )
      lose.loseContext()
      await lost
      await new Promise((resolve) => setTimeout(resolve, 100))
      const restored = new Promise<void>((resolve) =>
        canvas.addEventListener('webglcontextrestored', () => resolve(), {
          once: true,
        }),
      )
      lose.restoreContext()
      await restored
      const pixels = new Uint8Array(16 * 16 * 4)
      gl.readPixels(0, 0, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      return pixels.filter((value, index) => index % 4 === 3 && value > 0)
        .length
    } finally {
      canvas.remove()
      backend.dispose()
    }
  },
}
