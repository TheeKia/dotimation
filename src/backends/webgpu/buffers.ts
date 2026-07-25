import { QUAD, STATE_FLOATS, TARGET_FLOATS } from '../gpu-shared'

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

export function disposeBuffers(b: GPUBuffers): void {
  b.quad.destroy()
  b.state[0].destroy()
  b.state[1].destroy()
  b.targets.destroy()
}
