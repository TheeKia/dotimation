import { STATE_FLOATS, TARGET_FLOATS } from '@/engine/reconcile-plan'
import type { ParticleField } from '@/types'

// Unit quad as a triangle strip (4 corners in [0,1]).
const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1])

export interface GLBuffers {
  capacity: number
  quad: WebGLBuffer
  state: [WebGLBuffer, WebGLBuffer] // ping-pong
  targets: WebGLBuffer
  read: 0 | 1 // index of the current (read) state buffer
}

function makeBuffer(
  gl: WebGL2RenderingContext,
  bytes: number,
  usage: number,
): WebGLBuffer {
  const b = gl.createBuffer()
  if (!b) throw new Error('webgl2: createBuffer failed')
  gl.bindBuffer(gl.ARRAY_BUFFER, b)
  gl.bufferData(gl.ARRAY_BUFFER, bytes, usage)
  return b
}

export function createBuffers(
  gl: WebGL2RenderingContext,
  capacity: number,
): GLBuffers {
  const quad = gl.createBuffer()
  if (!quad) throw new Error('webgl2: createBuffer failed')
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW)

  const stateBytes = capacity * STATE_FLOATS * 4
  const targetBytes = capacity * TARGET_FLOATS * 4
  return {
    capacity,
    quad,
    state: [
      makeBuffer(gl, stateBytes, gl.DYNAMIC_COPY),
      makeBuffer(gl, stateBytes, gl.DYNAMIC_COPY),
    ],
    targets: makeBuffer(gl, targetBytes, gl.DYNAMIC_DRAW),
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

export function disposeBuffers(gl: WebGL2RenderingContext, b: GLBuffers): void {
  gl.deleteBuffer(b.quad)
  gl.deleteBuffer(b.state[0])
  gl.deleteBuffer(b.state[1])
  gl.deleteBuffer(b.targets)
}
