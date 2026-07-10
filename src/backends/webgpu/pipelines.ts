import { MAX_STEPS_PER_FRAME } from '@/engine/clock'
import { STATE_FLOATS } from '@/engine/reconcile-plan'
import { DRAW_WGSL } from './shaders/draw.wgsl'
import { SIM_WGSL } from './shaders/sim.wgsl'

const STATE_STRIDE = STATE_FLOATS * 4
const SIM_U_BYTES = 8 * 4

export interface Pipelines {
  compute: GPUComputePipeline
  render: GPURenderPipeline
  simUniform: GPUBuffer
  /** Byte stride between per-step slices of simUniform (alignment-padded). */
  simUniformStride: number
  renderUniform: GPUBuffer
  simBindGroup(
    inState: GPUBuffer,
    outState: GPUBuffer,
    targets: GPUBuffer,
  ): GPUBindGroup
  renderBindGroup(): GPUBindGroup
  device: GPUDevice
}

export function createPipelines(
  device: GPUDevice,
  format: GPUTextureFormat,
): Pipelines {
  const simModule = device.createShaderModule({ code: SIM_WGSL })
  const drawModule = device.createShaderModule({ code: DRAW_WGSL })

  // The sim uniform holds one slice PER physics step of the frame, bound via
  // dynamic offset, so each batched compute pass gets its own jitter seed —
  // reusing one seed across passes applies identical jitter N times in the
  // same direction (amplified shimmer vs. the other tiers).
  const simUniformStride = Math.max(
    device.limits.minUniformBufferOffsetAlignment,
    SIM_U_BYTES,
  )
  const simLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: 'uniform',
          hasDynamicOffset: true,
          minBindingSize: SIM_U_BYTES,
        },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      },
    ],
  })
  const compute = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [simLayout] }),
    compute: { module: simModule, entryPoint: 'main' },
  })

  const render = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: drawModule,
      entryPoint: 'vs',
      buffers: [
        {
          arrayStride: 2 * 4,
          stepMode: 'vertex',
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
        },
        {
          arrayStride: STATE_STRIDE,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 1, offset: 0, format: 'float32x2' },
            { shaderLocation: 2, offset: 4 * 4, format: 'float32x3' },
            { shaderLocation: 3, offset: 7 * 4, format: 'float32' },
          ],
        },
      ],
    },
    fragment: {
      module: drawModule,
      entryPoint: 'fs',
      targets: [
        {
          format,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-strip' },
  })

  const simUniform = device.createBuffer({
    size: simUniformStride * MAX_STEPS_PER_FRAME,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const renderUniform = device.createBuffer({
    size: 4 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  return {
    compute,
    render,
    simUniform,
    simUniformStride,
    renderUniform,
    device,
    simBindGroup(inState, outState, targets): GPUBindGroup {
      return device.createBindGroup({
        layout: simLayout,
        entries: [
          {
            binding: 0,
            resource: { buffer: simUniform, offset: 0, size: SIM_U_BYTES },
          },
          { binding: 1, resource: { buffer: inState } },
          { binding: 2, resource: { buffer: outState } },
          { binding: 3, resource: { buffer: targets } },
        ],
      })
    },
    renderBindGroup(): GPUBindGroup {
      return device.createBindGroup({
        layout: render.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: renderUniform } }],
      })
    },
  }
}
