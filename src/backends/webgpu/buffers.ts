import { STATE_FLOATS, TARGET_FLOATS } from '@/engine/reconcile-plan'
import type { ParticleField } from '@/types'

// Unit quad as a triangle strip (4 corners in [0,1]).
const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1])

export interface GPUBuffers {
  capacity: number
  quad: GPUBuffer
  state: [GPUBuffer, GPUBuffer]
  targets: GPUBuffer
  read: 0 | 1
}

const STATE_USAGE =
  GPUBufferUsage.STORAGE |
  GPUBufferUsage.VERTEX |
  GPUBufferUsage.COPY_SRC |
  GPUBufferUsage.COPY_DST
const TARGET_USAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST

function makeBuffer(
  device: GPUDevice,
  bytes: number,
  usage: number,
): GPUBuffer {
  return device.createBuffer({ size: bytes, usage })
}

export function createBuffers(device: GPUDevice, capacity: number): GPUBuffers {
  const quad = device.createBuffer({
    size: QUAD.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(quad, 0, QUAD)
  const stateBytes = capacity * STATE_FLOATS * 4
  const targetBytes = capacity * TARGET_FLOATS * 4
  return {
    capacity,
    quad,
    state: [
      makeBuffer(device, stateBytes, STATE_USAGE),
      makeBuffer(device, stateBytes, STATE_USAGE),
    ],
    targets: makeBuffer(device, targetBytes, TARGET_USAGE),
    read: 0,
  }
}

/** Writes interleaved state [x,y,vx,vy,r,g,b,alpha] for slots [start,end) into `out`; returns the used view. */
export function packStateInto(
  out: Float32Array,
  field: ParticleField,
  start: number,
  end: number,
): Float32Array {
  let o = 0
  for (let i = start; i < end; i++) {
    out[o++] = field.x[i]!
    out[o++] = field.y[i]!
    out[o++] = field.vx[i]!
    out[o++] = field.vy[i]!
    out[o++] = field.r[i]!
    out[o++] = field.g[i]!
    out[o++] = field.b[i]!
    out[o++] = field.alpha[i]!
  }
  return out.subarray(0, o)
}

/** Writes interleaved targets for slots [0,count) into `out`; returns the used view. */
export function packTargetsInto(
  out: Float32Array,
  field: ParticleField,
  count: number,
): Float32Array {
  let o = 0
  for (let i = 0; i < count; i++) {
    out[o++] = field.homeX[i]!
    out[o++] = field.homeY[i]!
    out[o++] = field.homeR[i]!
    out[o++] = field.homeG[i]!
    out[o++] = field.homeB[i]!
    out[o++] = field.targetAlpha[i]!
  }
  return out.subarray(0, o)
}

export function disposeBuffers(b: GPUBuffers): void {
  b.quad.destroy()
  b.state[0].destroy()
  b.state[1].destroy()
  b.targets.destroy()
}
